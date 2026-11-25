import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { cashForecast, changeAccountingChoices, closeFiscalYear, postPending, runClose, setDefaultTreasuryAccount, treasuryOverview } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant, twoTenants } from "@/test/tenant";

// SPEC-finance §9 "Default cash box and bank account": the farm events paid in cash or at the bank name no account; they
// go on the default cash box or bank account, so /treasury shows a balance per account and no "non affecté" line.
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-20T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const today = farmDayOf(new Date());
const day = addFarmDays(today, -2);
/** The 51xx lines a source posted, every version and reversal: [account, debit, credit, treasury account]. */
const treasuryLines = async (sourceId: string) => {
  const ids = (await db.journalEntry.findMany({ where: { sourceId }, select: { id: true } })).map((e) => e.id);
  const lines = await db.journalLine.findMany({
    where: { account: { in: ["5141", "5161"] }, entry: { OR: [{ id: { in: ids } }, { reversesId: { in: ids } }] } },
    orderBy: [{ entry: { createdAt: "asc" } }, { debitCentimes: "desc" }],
  });
  return lines.map((l) => [l.account, l.debitCentimes, l.creditCentimes, l.treasuryId]);
};

describe("default cash box and bank account (SPEC-finance §9)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), buyer: uuidv7(), supplier: uuidv7(), feed: uuidv7(), box: uuidv7(), bankA: uuidv7(), bankB: uuidv7() };
  const idOf = (x: PushedMutation) => (x.payload as { id: string }).id;
  const cashSale = (paid: string) =>
    m("sales.recordSale", { id: uuidv7(), batchId: ids.batch, buyerId: ids.buyer, day, birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: paid, instrument: null });
  const bankPurchase = () =>
    m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day, quantity: 100_000, unitPriceCentimes: "500", paidCentimes: "50000", paidMethod: "transfer", dueOn: null });
  const overview = async () => {
    const o = await treasuryOverview(a, today.slice(0, 7));
    if (!o.ok) throw new Error(o.error);
    return o.value;
  };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a, b] = await twoTenants();
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: addFarmDays(today, -40), chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null }),
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
      ),
    ).toEqual(Array(6).fill("applied"));
  });

  it("leaves a sale paid in cash before any cash box on no account, and the books as they were", async () => {
    const early = cashSale("300000");
    expect(await statuses(a, early)).toEqual(["applied"]);
    await postPending(a);
    expect(await treasuryLines(idOf(early))).toEqual([["5161", 300_000n, 0n, null]]);
    expect((await overview()).unassignedCentimes).toBe(300_000n);

    // Corrected once a cash box exists: the reversal mirrors the old entry (no account), the new version goes on the box.
    expect(await statuses(a, m("finance.createTreasuryAccount", { id: ids.box, kind: "cash", name: "Caisse ferme" }), m("finance.createTreasuryAccount", { id: ids.bankA, kind: "bank", name: "Banque A" }))).toEqual(["applied", "applied"]);
    expect(await statuses(a, m("sales.correctSale", { saleId: idOf(early), pricePerKgCentimes: "1600", linePrices: [], vatCentimes: "0" }))).toEqual(["applied"]);
    expect(await postPending(a)).toBe(2);
    expect(await treasuryLines(idOf(early))).toEqual([["5161", 300_000n, 0n, null], ["5161", 0n, 300_000n, null], ["5161", 300_000n, 0n, ids.box]]);
    expect((await overview()).unassignedCentimes).toBe(0n);
  });

  it("posts a cash sale to the only cash box and a bank purchase to the only bank account", async () => {
    const sale = cashSale("100000");
    const purchase = bankPurchase();
    expect(await statuses(a, sale, purchase)).toEqual(["applied", "applied"]);
    await postPending(a);
    expect(await treasuryLines(idOf(sale))).toEqual([["5161", 100_000n, 0n, ids.box]]);
    expect(await treasuryLines(idOf(purchase))).toEqual([["5141", 0n, 50_000n, ids.bankA]]);
    const o = await overview();
    expect(o.accounts.map((x) => [x.name, x.balanceCentimes, x.isDefault])).toEqual([["Banque A", -50_000n, true], ["Caisse ferme", 400_000n, true]]);
    expect(o.unassignedCentimes).toBe(0n);
    const forecast = await cashForecast(a);
    if (!forecast.ok) throw new Error(forecast.error);
    expect(forecast.value.startCentimes).toBe(350_000n); // the accounts' balances, nothing left aside
  });

  it("keeps the first bank account while none is marked, then the one the owner marks", async () => {
    expect(await statuses(a, m("finance.createTreasuryAccount", { id: ids.bankB, kind: "bank", name: "Banque B" }))).toEqual(["applied"]);
    const before = bankPurchase();
    expect(await statuses(a, before)).toEqual(["applied"]);
    await postPending(a);
    expect(await treasuryLines(idOf(before))).toEqual([["5141", 0n, 50_000n, ids.bankA]]); // none marked: the first created

    expect(await setDefaultTreasuryAccount(a, ids.bankB)).toEqual({ ok: true, value: undefined });
    const after = bankPurchase();
    expect(await statuses(a, after)).toEqual(["applied"]);
    await postPending(a);
    expect(await treasuryLines(idOf(after))).toEqual([["5141", 0n, 50_000n, ids.bankB]]);
    expect(await treasuryLines(idOf(before))).toEqual([["5141", 0n, 50_000n, ids.bankA]]); // posted lines stay where they went

    const o = await overview();
    expect(o.accounts.map((x) => [x.name, x.balanceCentimes, x.isDefault])).toEqual([["Banque A", -100_000n, false], ["Banque B", -50_000n, true], ["Caisse ferme", 400_000n, true]]);
    expect(o.unassignedCentimes).toBe(0n);
    const audited = await db.auditEvent.findFirstOrThrow({ where: { entity: "TreasuryAccount", entityId: ids.bankB, action: "setDefault" } });
    expect([audited.before, audited.after]).toEqual([{ defaultId: ids.bankA }, { defaultId: ids.bankB }]);

    // Back to the first: one default per kind, the cash box untouched.
    expect(await setDefaultTreasuryAccount(a, ids.bankA)).toEqual({ ok: true, value: undefined });
    expect(await db.treasuryAccount.findMany({ where: { organizationId: a.organizationId, isDefault: true }, select: { id: true } })).toEqual([{ id: ids.bankA }]);
    expect((await overview()).accounts.filter((x) => x.isDefault).map((x) => x.name)).toEqual(["Banque A", "Caisse ferme"]);
  });

  it("lets only the owner and the manager pick it, among their own accounts", async () => {
    for (const role of ["worker", "accountant", "vet"] as const) expect(await setDefaultTreasuryAccount({ ...a, role }, ids.bankB)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await setDefaultTreasuryAccount({ ...a, role: "manager" }, ids.bankB)).toEqual({ ok: true, value: undefined });
    expect(await setDefaultTreasuryAccount(b, ids.bankA)).toEqual({ ok: false, error: "NOT_FOUND" }); // a's account
    expect(await setDefaultTreasuryAccount(a, "not-a-uuid")).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await setDefaultTreasuryAccount(a, uuidv7())).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});

// The à-nouveaux name no account and /treasury leaves them out (FN10): the defaults' lines keep their accounts in year 2.
describe("default accounts across a year close (SPEC-finance §9, FN10, FCX5)", () => {
  it("shows year 1's balances per account in year 2, with nothing unassigned", async () => {
    const clock = fixedClock("2026-02-15T10:00:00Z");
    const owner = await tenant("+212600000071");
    const entity = (await listLegalEntities(owner))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 }, fixedClock("2024-12-01T10:00:00Z"))).toMatchObject({ ok: true });
    const [box, bank] = [uuidv7(), uuidv7()];
    const expense = (day: string, paidFrom: string, amountCentimes: string) => m("finance.recordExpense", { id: uuidv7(), day, category: "electricity", amountCentimes, paidFrom, treasuryId: null, note: null });
    expect(
      await statuses(
        owner,
        m("finance.createTreasuryAccount", { id: box, kind: "cash", name: "Caisse" }),
        m("finance.createTreasuryAccount", { id: bank, kind: "bank", name: "Banque" }),
        expense("2025-03-10", "cash", "120000"), // no cash box named: the default
        expense("2025-03-11", "bank", "30000"), // no bank account named: the default
        m("finance.recordTransfer", { id: uuidv7(), day: "2025-04-01", amountCentimes: "50000", fromId: box, toId: bank }),
      ),
    ).toEqual(Array(5).fill("applied"));
    const balances = async (month: string) => {
      const o = await treasuryOverview(owner, month);
      if (!o.ok) throw new Error(o.error);
      return { accounts: o.value.accounts.map((x) => [x.name, x.balanceCentimes]), unassigned: o.value.unassignedCentimes };
    };
    const year1 = await balances("2025-12");
    expect(year1).toEqual({ accounts: [["Banque", 20_000n], ["Caisse", -170_000n]], unassigned: 0n });

    expect(await runClose(owner, { year: 2025 }, clock)).toMatchObject({ ok: true });
    expect(await closeFiscalYear(owner, { year: 2025 }, clock)).toMatchObject({ ok: true });
    const opening = await db.journalLine.findMany({ where: { organizationId: owner.organizationId, account: { in: ["5141", "5161"] }, entry: { sourceId: { startsWith: "opening:" } } }, orderBy: { account: "asc" } });
    expect(opening.map((l) => [l.account, l.debitCentimes, l.creditCentimes, l.treasuryId])).toEqual([["5141", 20_000n, 0n, null], ["5161", 0n, 170_000n, null]]); // carried forward on no account
    expect(await balances("2026-01")).toEqual(year1);
  });
});
