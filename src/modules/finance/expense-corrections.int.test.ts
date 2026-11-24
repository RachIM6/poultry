import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { creditExpensesToPay, payCreditExpense, setPeriodLocked } from "@/modules/finance";
import { AccountsFile, FINANCE_MUTATIONS as F } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

// SPEC-finance §9 "Cancelled records": a quick expense corrected or cancelled, and its entries.
const m = (type: string, payload: unknown) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-20T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: ReturnType<typeof m>[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));
const today = farmDayOf(new Date());
const lastMonth = `${addFarmDays(`${today.slice(0, 7)}-01` as typeof today, -1).slice(0, 7)}`;
/** Each entry of the expense (and its reversals) as [version, day, account, debit, credit], in posting order. */
const entriesOf = async (id: string) => {
  const own = await db.journalEntry.findMany({ where: { sourceModule: "finance", sourceId: id }, select: { id: true } });
  const lines = await db.journalLine.findMany({
    where: { entry: { OR: [{ id: { in: own.map((e) => e.id) } }, { reversesId: { in: own.map((e) => e.id) } }] } },
    include: { entry: true },
    orderBy: [{ entry: { createdAt: "asc" } }, { account: "asc" }],
  });
  return lines.map((l) => [l.entry.sourceVersion, l.entry.day.toISOString().slice(0, 10), l.account, l.debitCentimes, l.creditCentimes]);
};

describe("corrected and cancelled quick expenses (SPEC-finance §9)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { box: uuidv7(), bank: uuidv7(), farm: uuidv7(), house: uuidv7(), batch: uuidv7() };
  const expense = (over: object = {}) => ({ id: uuidv7(), day: today, category: "electricity", amountCentimes: "120000", vatCentimes: "0", paidFrom: "cash", treasuryId: ids.box, note: null, batchId: null, serviceMonth: null, ...over });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a, b] = await twoTenants();
    expect(
      await statuses(
        a,
        m(F.createTreasuryAccount, { id: ids.box, kind: "cash", name: "Caisse" }),
        m(F.createTreasuryAccount, { id: ids.bank, kind: "bank", name: "Banque" }),
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: addFarmDays(today, -20), chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null }),
      ),
    ).toEqual(Array(5).fill("applied"));
  });

  it("corrects an expense: its entry is reversed on its day and the corrected one posted as the next version", async () => {
    const e = expense();
    expect(await statuses(a, m(F.recordExpense, e))).toEqual(["applied"]);
    const corrected = { ...e, amountCentimes: "150000", category: "water", paidFrom: "bank", treasuryId: ids.bank, batchId: ids.batch, note: "Facture corrigée" };
    const correction = m(F.correctExpense, corrected);
    expect(await statuses(a, correction, correction)).toEqual(["applied", "applied"]); // a replay: its stored result
    expect(await entriesOf(e.id)).toEqual([
      [1, today, "5161", 0n, 120_000n],
      [1, today, "612512", 120_000n, 0n], // electricity
      [null, today, "5161", 120_000n, 0n], // the reversal
      [null, today, "612512", 0n, 120_000n],
      [2, today, "5141", 0n, 150_000n],
      [2, today, "612511", 150_000n, 0n], // water
    ]);
    expect(await db.expense.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ category: "water", amountCentimes: 150_000n, paidFrom: "bank", treasuryId: ids.bank, batchId: ids.batch });
    expect((await pull(a, 0, registry)).changes.filter((c) => c.id === e.id).at(-1)?.data).toMatchObject({ amountCentimes: "150000", category: "water" });
    const audited = await db.auditEvent.findFirstOrThrow({ where: { entity: "Expense", entityId: e.id, action: "correct" } });
    expect([audited.before, audited.after]).toMatchObject([{ amountCentimes: "120000", paidFrom: "cash" }, { amountCentimes: "150000", paidFrom: "bank" }]);
    expect(await statuses(a, m(F.correctExpense, { ...corrected, amountCentimes: "100", vatCentimes: "200" }))).toEqual(["VAT_MORE_THAN_AMOUNT"]); // FX4's checks
  });

  it("cancels an expense: it leaves the phones, its entry is reversed", async () => {
    const e = expense({ paidFrom: "credit", treasuryId: null, amountCentimes: "30000", category: "water" });
    expect(await statuses(a, m(F.recordExpense, e))).toEqual(["applied"]);
    expect((await creditExpensesToPay(a)).ok && (await creditExpensesToPay(a))).toMatchObject({ value: [{ expenseId: e.id, owed: 30_000n }] });
    expect(await statuses(a, m(F.cancelExpense, { expenseId: e.id }))).toEqual(["applied"]);
    expect(await statuses(a, m(F.cancelExpense, { expenseId: e.id }))).toEqual(["NOT_FOUND"]);
    expect(await db.expense.count({ where: { id: e.id } })).toBe(0);
    expect((await pull(a, 0, registry)).changes.filter((c) => c.id === e.id).at(-1)?.data).toBeNull();
    expect((await entriesOf(e.id)).map(([v, , account, debit, credit]) => [v, account, debit, credit])).toEqual([
      [1, "4411", 0n, 30_000n],
      [1, "612511", 30_000n, 0n],
      [null, "4411", 30_000n, 0n],
      [null, "612511", 0n, 30_000n],
    ]);
    expect(await creditExpensesToPay(a)).toEqual({ ok: true, value: [] });
    expect(await db.auditEvent.findFirstOrThrow({ where: { entity: "Expense", entityId: e.id, action: "cancel" } })).toMatchObject({ before: { amountCentimes: "30000", paidFrom: "credit" } });
  });

  it("corrects an unpaid credit expense: what is owed follows; once paid, it can no longer change", async () => {
    const e = expense({ paidFrom: "credit", treasuryId: null, amountCentimes: "30000" });
    expect(await statuses(a, m(F.recordExpense, e), m(F.correctExpense, { ...e, amountCentimes: "35000" }))).toEqual(["applied", "applied"]);
    expect(await creditExpensesToPay(a)).toMatchObject({ value: [{ expenseId: e.id, owed: 35_000n }] });
    const clock = fixedClock(`${today}T12:00:00Z`);
    expect(await payCreditExpense(a, { id: uuidv7(), expenseId: e.id, day: today, amountCentimes: "1000", paidWith: "cash", treasuryId: null }, clock)).toEqual({ ok: true, value: undefined });
    const changes = await db.change.count();
    expect(await statuses(a, m(F.correctExpense, { ...e, amountCentimes: "40000" }), m(F.cancelExpense, { expenseId: e.id }))).toEqual(["EXPENSE_PAID", "EXPENSE_PAID"]);
    expect(await db.change.count()).toBe(changes);
  });

  it("refuses an expense a closed batch counts, or in a locked month", async () => {
    const direct = expense({ batchId: ids.batch });
    const earlier = expense({ day: `${lastMonth}-15` });
    const toLock = expense();
    expect(await statuses(a, m(F.recordExpense, direct), m(F.recordExpense, earlier), m(F.recordExpense, toLock))).toEqual(Array(3).fill("applied"));
    const entity = (await listLegalEntities(a))[0].id;
    expect(await setPeriodLocked(a, entity, lastMonth, true)).toEqual({ ok: true, value: undefined });
    expect(await statuses(a, m(F.cancelExpense, { expenseId: earlier.id }), m(F.correctExpense, { ...toLock, day: `${lastMonth}-20` }))).toEqual(["PERIOD_LOCKED", "PERIOD_LOCKED"]);
    expect(await setPeriodLocked(a, entity, lastMonth, false)).toEqual({ ok: true, value: undefined });
    await db.batch.update({ where: { id: ids.batch }, data: { status: "closed" } }); // its closing isn't the point here
    expect(await statuses(a, m(F.cancelExpense, { expenseId: direct.id }), m(F.correctExpense, { ...toLock, batchId: ids.batch }))).toEqual(["EXPENSE_IN_CLOSED_BATCH", "EXPENSE_IN_CLOSED_BATCH"]);
    await db.batch.update({ where: { id: ids.batch }, data: { status: "open" } });
    expect(await statuses(a, m(F.cancelExpense, { expenseId: earlier.id }))).toEqual(["applied"]);
  });

  it("is the owner's and the manager's, each organisation its own", async () => {
    const e = expense();
    expect(await statuses(a, m(F.recordExpense, e))).toEqual(["applied"]);
    for (const role of ["worker", "accountant"] as const) expect(await statuses({ ...a, role }, m(F.cancelExpense, { expenseId: e.id })), role).toEqual(["FORBIDDEN"]);
    expect(await statuses(b, m(F.cancelExpense, { expenseId: e.id }), m(F.correctExpense, { ...e, treasuryId: null, paidFrom: "credit" }))).toEqual(["NOT_FOUND", "NOT_FOUND"]);
    expect(await db.expense.count({ where: { id: e.id } })).toBe(1);
    expect(await statuses({ ...a, role: "manager" }, m(F.cancelExpense, { expenseId: e.id }))).toEqual(["applied"]);
  });
});
