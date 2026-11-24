import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { SALES_MUTATIONS as S, buyerBalances } from "@/modules/sales/schema";
import { twoTenants } from "@/test/tenant";

// SPEC-finance §9 "Cancelled records": a sale cancelled or its prices corrected, and the figures that follow it.
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-20T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));
const today = farmDayOf(new Date());
const day = addFarmDays(today, -2);
/** The ledger's net for a source: Σdebit − Σcredit per account, zero lines left out. */
const net = async (sourceId: string) => {
  const entries = await db.journalEntry.findMany({ where: { sourceId }, select: { id: true } });
  const ids = entries.map((e) => e.id);
  const lines = await db.journalLine.findMany({ where: { entry: { OR: [{ id: { in: ids } }, { reversesId: { in: ids } }] } } });
  const out = new Map<string, bigint>();
  for (const l of lines) out.set(l.account, (out.get(l.account) ?? 0n) + l.debitCentimes - l.creditCentimes);
  return Object.fromEntries([...out].filter(([, v]) => v !== 0n));
};
const owed = async (buyerId: string) => {
  const [sales, payments] = await Promise.all([db.sale.findMany({ where: { buyerId } }), db.buyerPayment.findMany({ where: { buyerId } })]);
  return buyerBalances(sales, payments).get(buyerId) ?? 0n;
};

describe("cancelled and corrected sales (SPEC-finance §9)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), house2: uuidv7(), batch: uuidv7(), layers: uuidv7(), buyer: uuidv7() };
  const sale = (over: object = {}) =>
    m(S.recordSale, { id: uuidv7(), batchId: ids.batch, buyerId: ids.buyer, day, birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1450", paymentMethod: "credit", paidCentimes: "0", instrument: null, ...over });
  const idOf = (x: PushedMutation) => (x.payload as { id: string }).id;
  const cancel = (saleId: string) => m(S.cancelSale, { saleId });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.createMany({ data: [{ id: "ross-308", name: "Ross 308" }, { id: "lohmann-brown", name: "Lohmann Brown", productionTypes: ["pullet", "layer"] }] });
    [a, b] = await twoTenants();
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("farm-registry.createHouse", { id: ids.house2, farmId: ids.farm, name: "P1", areaM2: 1000, capacity: 6000, type: "closed" }),
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: addFarmDays(today, -40), chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null }),
        m("flock.placeBatch", { id: ids.layers, houseId: ids.house2, species: "layer", strainId: "lohmann-brown", placedOn: addFarmDays(today, -10), chicksPlaced: 6000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 200 }),
        m("eggs.recordCollection", { id: uuidv7(), batchId: ids.layers, day, counts: { normal: 600, cracked: 0, dirty: 0, doubleYolk: 0, floor: 0, broken: 0 }, sample: null }),
        m(S.createBuyer, { id: ids.buyer, name: "Abattoir Atlas", phone: null, type: "abattoir" }),
      ),
    ).toEqual(Array(7).fill("applied"));
  });

  it("cancels a live sale: its birds come back, the buyer owes it no more, the phones drop it, the books reverse it", async () => {
    const given = sale();
    expect(await statuses(a, given)).toEqual(["applied"]);
    await postPending(a);
    expect(await net(idOf(given))).toEqual({ "3421": 290_000n, "712121": -290_000n }); // 200 kg × 14,50
    expect(await owed(ids.buyer)).toBe(290_000n);

    const cancelled = cancel(idOf(given));
    const version = async () => (await db.change.count({ where: { organizationId: a.organizationId } }));
    expect(await statuses(a, cancelled)).toEqual(["applied"]);
    const after = await version();
    expect(await statuses(a, cancelled)).toEqual(["applied"]); // the same mutation again: its stored result, nothing more
    expect(await version()).toBe(after);
    expect(await statuses(a, cancel(idOf(given)))).toEqual(["NOT_FOUND"]); // cancelled once

    expect([await db.sale.count({ where: { id: idOf(given) } }), await db.soldBirds.count({ where: { id: idOf(given) } })]).toEqual([0, 0]);
    expect(await owed(ids.buyer)).toBe(0n);
    const { changes } = await pull(a, 0, registry);
    for (const entity of ["sale", "soldBirds"]) expect(changes.filter((c) => c.entity === entity && c.id === idOf(given)).at(-1)?.data, entity).toBeNull();

    expect(await postPending(a)).toBe(1); // the reversal, nothing new
    expect(await net(idOf(given))).toEqual({});
    expect(await db.journalEntry.count({ where: { reversesId: { not: null }, label: "Annulation" } })).toBe(1);
    const audited = await db.auditEvent.findFirstOrThrow({ where: { entity: "Sale", entityId: idOf(given), action: "cancel" } });
    expect(audited.before).toMatchObject({ id: idOf(given), birds: 100, amountCentimes: "290000", buyerId: ids.buyer });
    expect(audited.mutationId).toBe(cancelled.id);
  });

  it("is the owner's and the manager's, each organisation its own", async () => {
    const given = sale({ birds: 10, farmWeightGrams: 20_000 });
    expect(await statuses(a, given)).toEqual(["applied"]);
    expect(await statuses({ ...a, role: "worker" }, cancel(idOf(given)))).toEqual(["FORBIDDEN"]);
    expect(await statuses({ ...a, role: "accountant" }, cancel(idOf(given)))).toEqual(["FORBIDDEN"]);
    expect(await statuses(b, cancel(idOf(given)))).toEqual(["NOT_FOUND"]);
    expect(await statuses(b, m(S.correctSale, { saleId: idOf(given), pricePerKgCentimes: "1", linePrices: [], vatCentimes: "0" }))).toEqual(["NOT_FOUND"]);
    expect(await db.sale.count({ where: { id: idOf(given) } })).toBe(1);
    expect(await statuses({ ...a, role: "manager" }, cancel(idOf(given)))).toEqual(["applied"]);
  });

  it("refuses, writing nothing, once the buyer's later payments cover the sale or its cheque has moved", async () => {
    const credit = sale({ birds: 10, farmWeightGrams: 20_000 }); // 290,00
    expect(await statuses(a, credit, m(S.recordPayment, { id: uuidv7(), buyerId: ids.buyer, day: today, amountCentimes: "29000", method: "cash" }))).toEqual(["applied", "applied"]);
    const cheque = sale({ birds: 10, farmWeightGrams: 20_000, paymentMethod: "cheque", paidCentimes: "29000", instrument: { number: "C-1", dueOn: today } });
    expect(await statuses(a, cheque, m(S.setInstrumentState, { id: uuidv7(), instrumentId: idOf(cheque), state: "remitted", day: today }))).toEqual(["applied", "applied"]);
    const changes = await db.change.count();
    expect(await statuses(a, cancel(idOf(credit)), cancel(idOf(cheque)))).toEqual(["SALE_HAS_PAYMENT", "SALE_HAS_PAYMENT"]);
    // a correction may not take the amount below what the payments cover either
    expect(await statuses(a, m(S.correctSale, { saleId: idOf(credit), pricePerKgCentimes: "1000", linePrices: [], vatCentimes: "0" }))).toEqual(["SALE_HAS_PAYMENT"]);
    expect(await db.change.count()).toBe(changes);
    expect(await db.soldBirds.count({ where: { id: { in: [idOf(credit), idOf(cheque)] } } })).toBe(2);
  });

  it("corrects a sale's price: the amount, the buyer's balance and the books follow; quantities don't move", async () => {
    const typo = sale({ birds: 20, farmWeightGrams: 40_000, pricePerKgCentimes: "14500", paymentMethod: "cash", paidCentimes: "50000" }); // 145,00 for 14,50
    expect(await statuses(a, typo)).toEqual(["applied"]);
    await postPending(a);
    const before = await owed(ids.buyer);
    const correct = (over: object) => m(S.correctSale, { saleId: idOf(typo), pricePerKgCentimes: "1450", linePrices: [], vatCentimes: "0", ...over });
    expect(await statuses(a, correct({ pricePerKgCentimes: "1000" }))).toEqual(["PAID_MORE_THAN_AMOUNT"]); // 400,00 < 500,00 paid
    expect(await statuses(a, correct({ linePrices: ["1450"] }))).toEqual(["INVALID_INPUT"]); // a live sale is priced per kg
    expect(await statuses(a, correct({ vatCentimes: "60000" }))).toEqual(["VAT_MORE_THAN_AMOUNT"]);
    expect(await statuses(a, correct({ vatCentimes: "9667" }))).toEqual(["applied"]);

    expect(await db.sale.findUniqueOrThrow({ where: { id: idOf(typo) } })).toMatchObject({ pricePerKgCentimes: 1450n, amountCentimes: 58_000n, vatCentimes: 9667n, birds: 20, paidCentimes: 50_000n });
    expect(await owed(ids.buyer)).toBe(before - 580_000n + 58_000n);
    expect(await db.soldBirds.findUniqueOrThrow({ where: { id: idOf(typo) } })).toMatchObject({ birds: 20 });
    expect((await pull(a, 0, registry)).changes.filter((c) => c.id === idOf(typo) && c.entity === "sale").at(-1)?.data).toMatchObject({ amountCentimes: "58000", pricePerKgCentimes: "1450" });
    expect(await postPending(a)).toBe(2); // the reversal and the corrected entry
    expect(await net(idOf(typo))).toEqual({ "3421": 8_000n, "5161": 50_000n, "712121": -58_000n }); // not VAT-registered: the whole total on the sale
    const audited = await db.auditEvent.findFirstOrThrow({ where: { entity: "Sale", entityId: idOf(typo), action: "correct" } });
    expect([audited.before, audited.after]).toMatchObject([{ amountCentimes: "580000" }, { amountCentimes: "58000" }]);
  });

  it("refuses to cancel a sale of a closed batch, but corrects its price", async () => {
    const onHand = 1000 - (await db.soldBirds.aggregate({ where: { batchId: ids.batch }, _sum: { birds: true } }))._sum.birds!;
    const last = sale({ birds: onHand, farmWeightGrams: onHand * 2000 });
    expect(await statuses(a, last)).toEqual(["applied"]);
    expect((await db.batch.findUniqueOrThrow({ where: { id: ids.batch } })).status).toBe("closed");
    expect(await statuses(a, cancel(idOf(last)))).toEqual(["BATCH_CLOSED"]);
    expect(await statuses(a, m(S.correctSale, { saleId: idOf(last), pricePerKgCentimes: "1500", linePrices: [], vatCentimes: "0" }))).toEqual(["applied"]);
    expect((await db.sale.findUniqueOrThrow({ where: { id: idOf(last) } })).amountCentimes).toBe(BigInt(onHand * 2000 * 15) / 10n);
  });

  it("cancels an egg sale: its eggs go back to the stock they were taken from", async () => {
    const eggs = m(S.recordEggSale, { id: uuidv7(), batchId: ids.layers, buyerId: ids.buyer, day: today, lines: [{ item: "ungraded", eggs: 450, unitPriceCentimes: "3300" }], paymentMethod: "credit", paidCentimes: "0", instrument: null });
    expect(await statuses(a, eggs)).toEqual(["applied"]);
    const draws = await db.eggDraw.findMany({ where: { saleId: idOf(eggs) } });
    expect(draws.map((d) => d.eggs)).toEqual([450]);
    // per tray: 15 trays at 33,00 → 30,00
    expect(await statuses(a, m(S.correctSale, { saleId: idOf(eggs), pricePerKgCentimes: null, linePrices: ["3000"], vatCentimes: "0" }))).toEqual(["applied"]);
    expect((await db.sale.findUniqueOrThrow({ where: { id: idOf(eggs) } })).amountCentimes).toBe(45_000n);
    expect(await db.saleLine.findFirstOrThrow({ where: { saleId: idOf(eggs) } })).toMatchObject({ unitPriceCentimes: 3000n, amountCentimes: 45_000n });

    expect(await statuses(a, cancel(idOf(eggs)))).toEqual(["applied"]);
    expect([await db.eggDraw.count({ where: { saleId: idOf(eggs) } }), await db.saleLine.count({ where: { saleId: idOf(eggs) } })]).toEqual([0, 0]);
    const tombstones = (await pull(a, 0, registry)).changes.filter((c) => c.entity === "eggDraw" && c.id === draws[0].id);
    expect(tombstones.at(-1)?.data).toBeNull();
    // all 600 eggs can be sold again
    expect(await statuses(a, m(S.recordEggSale, { id: uuidv7(), batchId: ids.layers, buyerId: ids.buyer, day: today, lines: [{ item: "ungraded", eggs: 600, unitPriceCentimes: "3300" }], paymentMethod: "credit", paidCentimes: "0", instrument: null }))).toEqual(["applied"]);
  });

  it("cancels a home consumption, which owes no one", async () => {
    const taken = m(S.recordConsumption, { id: uuidv7(), batchId: ids.layers, day: today, takenBy: "employee", kind: "perHead", lines: [{ item: "hen", birds: 2, pricePerHeadCentimes: "4000" }], farmWeightGrams: null });
    expect(await statuses(a, taken)).toEqual(["applied"]);
    expect(await statuses(a, m(S.correctSale, { saleId: idOf(taken), pricePerKgCentimes: null, linePrices: ["5000"], vatCentimes: "100" }))).toEqual(["INVALID_INPUT"]); // no VAT on a consumption
    expect(await statuses(a, m(S.correctSale, { saleId: idOf(taken), pricePerKgCentimes: null, linePrices: ["5000"], vatCentimes: "0" }))).toEqual(["applied"]);
    expect((await db.sale.findUniqueOrThrow({ where: { id: idOf(taken) } })).amountCentimes).toBe(10_000n);
    expect(await statuses(a, cancel(idOf(taken)))).toEqual(["applied"]);
    expect(await db.soldBirds.count({ where: { id: idOf(taken) } })).toBe(0);
  });
});
