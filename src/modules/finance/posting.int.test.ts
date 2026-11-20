import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { recordChange, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant, twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-01T08:00:00+01:00" });
const linesOf = async (where: object) =>
  (await db.journalLine.findMany({ where: { entry: where }, orderBy: [{ entry: { createdAt: "asc" } }, { account: "asc" }] })).map((l) => [
    l.account,
    l.debitCentimes,
    l.creditCentimes,
  ]);

describe("posting pipeline (SPEC-finance FN6–FN7, T30)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), supplier: uuidv7(), feed: uuidv7(), batch: uuidv7(), purchase: uuidv7() };
  const purchase = (id: string, paid: string) =>
    m("inventory.recordPurchase", { id, movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: "2026-03-02", quantity: 2_000_000, unitPriceCentimes: "450", paidCentimes: paid, dueOn: null });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a, b] = await twoTenants();
    const setup = await push(
      a,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
      ],
      registry,
    );
    expect(setup.results.every((r) => r.status === "applied")).toBe(true);
  });

  it("posts a feed purchase (9 000,00 DH, 3 000,00 paid) and the chicks of a placement", async () => {
    const pushed = await push(
      a,
      [
        purchase(ids.purchase, "300000"),
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: "2026-03-01", chicksPlaced: 8000, deadOnArrival: 12, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null }),
      ],
      registry,
    );
    expect(pushed.results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(await postPending(a)).toBe(2);

    expect(await linesOf({ sourceModule: "inventory", sourceId: ids.purchase })).toEqual([["4411", 0n, 600_000n], ["5161", 0n, 300_000n], ["612122", 900_000n, 0n]]);
    expect(await linesOf({ sourceModule: "flock", sourceId: ids.batch })).toEqual([["4411", 0n, 4_400_000n], ["612121", 4_400_000n, 0n]]);
  });

  it("creates no new entry when the same sync is replayed, or the pipeline runs again", async () => {
    const before = await db.journalEntry.count();
    const again = purchase(ids.purchase, "300000");
    await push(a, [again], registry); // same purchase id: refused ALREADY_EXISTS, nothing recorded
    await push(a, [again], registry); // same mutation id: the stored result
    expect(await postPending(a)).toBe(0);
    expect(await db.journalEntry.count()).toBe(before);
  });

  it("posts a reversal and a new entry when a purchase changes; nothing when a change leaves the books alone", async () => {
    // M1 has no purchase edit yet: a newer version in the change log stands for one (the paid part corrected).
    const p = await db.purchase.findUniqueOrThrow({ where: { id: ids.purchase } });
    await db.$transaction((tx) =>
      recordChange(tx, a, "purchase", p.id, { id: p.id, farmId: p.farmId, supplierId: p.supplierId, stockItemId: p.stockItemId, day: "2026-03-02", quantity: p.quantity, unitPriceCentimes: "450", amountCentimes: "900000", paidCentimes: "900000", dueOn: null }),
    );
    // The batch's record changes too (e.g. it closes) but its chicks cost the same.
    const batch = (await db.change.findFirstOrThrow({ where: { entityId: ids.batch }, orderBy: { version: "desc" } })).data as object;
    await db.$transaction((tx) => recordChange(tx, a, "batch", ids.batch, { ...batch, status: "closed" }));

    expect(await postPending(a)).toBe(2); // the purchase's reversal + its new entry; nothing for the batch
    const entries = await db.journalEntry.findMany({ where: { organizationId: a.organizationId }, orderBy: { createdAt: "asc" } });
    const reversal = entries.find((e) => e.label === "Annulation")!;
    expect(entries.find((e) => e.id === reversal.reversesId)?.sourceId).toBe(ids.purchase);
    expect((await linesOf({ id: entries.at(-1)!.id }))).toEqual([["5161", 0n, 900_000n], ["612122", 900_000n, 0n]]);
    expect(await db.journalEntry.count({ where: { sourceId: ids.batch } })).toBe(1);
  });

  it("posts to the CGNC account (6121) when the PCA is off", async () => {
    const [entity] = await listLegalEntities(b);
    expect(await changeAccountingChoices(b, entity.id, { books: null, pcaOverlay: false, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    const [farm, supplier, feed, id] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    await push(
      b,
      [
        m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("inventory.createSupplier", { id: supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: feed, farmId: farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
        m("inventory.recordPurchase", { id, movementId: uuidv7(), supplierId: supplier, stockItemId: feed, day: "2026-03-02", quantity: 1_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null }),
      ],
      registry,
    );
    expect(await postPending(b)).toBe(1);
    expect(await linesOf({ sourceId: id })).toEqual([["4411", 0n, 450_000n], ["6121", 450_000n, 0n]]);
    expect(await db.journalEntry.count({ where: { organizationId: b.organizationId, sourceId: ids.purchase } })).toBe(0); // only its own
  });

  it("books the invoices' VAT apart for a VAT-registered entity (FN9, T39)", async () => {
    const c = await tenant("+212600000003", "Ferme TVA");
    const [entity] = await listLegalEntities(c);
    expect(entity.vatRegistered).toBe(false); // the default until FQ4 is answered
    expect(await changeAccountingChoices(c, entity.id, { books: null, pcaOverlay: null, fiscalYearStartMonth: 1, vatRegistered: true })).toMatchObject({ ok: true });
    const [farm, house, supplier, feed, batch, buyer, purchaseId, saleId, box, expenseId] = Array.from({ length: 10 }, () => uuidv7());
    const pushed = await push(
      c,
      [
        m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: house, farmId: farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("inventory.createSupplier", { id: supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: feed, farmId: farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
        // 1 200,00 DH, 200,00 of it VAT
        m("inventory.recordPurchase", { id: purchaseId, movementId: uuidv7(), supplierId: supplier, stockItemId: feed, day: "2026-03-02", quantity: 1_000_000, unitPriceCentimes: "120", paidCentimes: "0", vatCentimes: "20000", dueOn: null }),
        m("flock.placeBatch", { id: batch, houseId: house, strainId: "ross-308", placedOn: "2026-03-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null }),
        m("sales.createBuyer", { id: buyer, name: "Hamid", phone: null, type: "trader" }),
        // 200 kg × 15,00 = 3 000,00 DH, 500,00 of it VAT
        m("sales.recordSale", { id: saleId, batchId: batch, buyerId: buyer, day: "2026-03-20", birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "credit", paidCentimes: "0", vatCentimes: "50000", instrument: null }),
        // a quick expense: 1 200,00 DH of electricity, 200,00 of it VAT
        m("finance.createTreasuryAccount", { id: box, kind: "cash", name: "Caisse" }),
        m("finance.recordExpense", { id: expenseId, day: "2026-03-21", category: "electricity", amountCentimes: "120000", vatCentimes: "20000", paidFrom: "cash", treasuryId: box, note: null }),
        m("finance.recordExpense", { id: uuidv7(), day: "2026-03-21", category: "water", amountCentimes: "100", vatCentimes: "101", paidFrom: "cash", treasuryId: box, note: null }),
        // VAT above the total is refused
        m("sales.recordSale", { id: uuidv7(), batchId: batch, buyerId: buyer, day: "2026-03-20", birds: 1, farmWeightGrams: 2_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "0", vatCentimes: "3001", instrument: null }),
      ],
      registry,
    );
    expect(pushed.results.map((r) => r.status)).toEqual([...Array(10).fill("applied"), "rejected", "rejected"]);
    expect(pushed.results[10]).toMatchObject({ messageKey: "errors.VAT_MORE_THAN_AMOUNT" });
    expect(pushed.results.at(-1)).toMatchObject({ messageKey: "errors.VAT_MORE_THAN_AMOUNT" });

    await postPending(c);
    expect(await linesOf({ sourceId: purchaseId })).toEqual([["3455", 20_000n, 0n], ["4411", 0n, 120_000n], ["612122", 100_000n, 0n]]);
    expect(await linesOf({ sourceId: saleId })).toEqual([["3421", 300_000n, 0n], ["4455", 0n, 50_000n], ["712121", 0n, 250_000n]]);
    expect(await linesOf({ sourceId: expenseId })).toEqual([["3455", 20_000n, 0n], ["5161", 0n, 120_000n], ["612512", 100_000n, 0n]]);
  });
});
