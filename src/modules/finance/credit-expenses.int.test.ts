import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { creditExpensesToPay, payCreditExpense, setPeriodLocked } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

// SPEC-finance §9 "Credit expenses": paying a quick expense recorded on credit (C 4411, FN6) from /treasury.
const clock = fixedClock("2026-06-15T10:00:00Z");
const OK = { ok: true, value: undefined };
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-10T08:00:00+01:00" });
const linesOf = async (sourceId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceModule: "finance", sourceId } }, include: { entry: true }, orderBy: { debitCentimes: "desc" } })).map((l) => [
    l.entry.journal,
    l.entry.day.toISOString().slice(0, 10),
    l.account,
    l.debitCentimes,
    l.creditCentimes,
    l.treasuryId,
  ]);
const paymentsOf = (expenseId: string) => db.journalEntry.count({ where: { sourceModule: "finance", sourceId: { startsWith: `expense:${expenseId}:pay:` } } });

/** A cash box, a bank account, two expenses on credit (electricity 1 200,00 with a note, water 300,00) and one paid in cash. */
async function farmWithExpenses(ctx: TenantContext) {
  const ids = { box: uuidv7(), bank: uuidv7(), power: uuidv7(), water: uuidv7(), cash: uuidv7() };
  const expense = (id: string, day: string, category: string, amountCentimes: string, paidFrom: string, note: string | null, treasuryId: string | null = null) =>
    m("finance.recordExpense", { id, day, category, amountCentimes, paidFrom, treasuryId, note });
  const pushed = await push(
    ctx,
    [
      m("finance.createTreasuryAccount", { id: ids.box, kind: "cash", name: "Caisse" }),
      m("finance.createTreasuryAccount", { id: ids.bank, kind: "bank", name: "Banque" }),
      expense(ids.water, "2026-03-04", "water", "30000", "credit", null),
      expense(ids.power, "2026-03-02", "electricity", "120000", "credit", "ONEE mars"),
      expense(ids.cash, "2026-03-03", "vet_fees", "50000", "cash", null, ids.box),
    ],
    registry,
  );
  expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
  return ids;
}

describe("credit expenses (SPEC-finance §9, FN6)", () => {
  let owner: TenantContext, other: TenantContext;
  let o: Awaited<ReturnType<typeof farmWithExpenses>>, x: typeof o;
  const pay = (expenseId: string, more: object = {}) => ({ id: uuidv7(), expenseId, day: "2026-04-10", amountCentimes: "10000", paidWith: "cash", treasuryId: null, ...more });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((a) => ({ chart: a.chart, number: a.number, label: a.label, parentNumber: a.parent, fallback: a.fallback })) });
    [owner, other] = await twoTenants();
    o = await farmWithExpenses(owner);
    x = await farmWithExpenses(other);
  });

  it("lists the expenses on credit still owed, oldest first; one paid in cash owes nothing", async () => {
    expect(await creditExpensesToPay(owner)).toEqual({
      ok: true,
      value: [
        { expenseId: o.power, day: "2026-03-02", category: "electricity", note: "ONEE mars", account: "4411", owed: 120_000n },
        { expenseId: o.water, day: "2026-03-04", category: "water", note: null, account: "4411", owed: 30_000n },
      ],
    });
  });

  it("pays D 4411 / C the cash box, once per form, up to what is owed", async () => {
    const first = pay(o.power, { amountCentimes: "100000", treasuryId: o.box });
    expect(await payCreditExpense(owner, first, clock)).toEqual(OK);
    expect(await payCreditExpense(owner, first, clock)).toEqual(OK); // the same form again
    expect(await linesOf(`expense:${o.power}:pay:${first.id}`)).toEqual([
      ["CA", "2026-04-10", "4411", 100_000n, 0n, null],
      ["CA", "2026-04-10", "5161", 0n, 100_000n, o.box],
    ]);
    expect((await db.journalEntry.findFirstOrThrow({ where: { sourceId: `expense:${o.power}:pay:${first.id}` } })).label).toBe("Paiement fournisseur : ONEE mars");
    expect(await payCreditExpense(owner, pay(o.power, { amountCentimes: "20001" }), clock)).toEqual({ ok: false, error: "PAID_MORE_THAN_OWED" });
    expect(await payCreditExpense(owner, pay(o.power, { amountCentimes: "20000", paidWith: "cheque", treasuryId: o.bank }), clock)).toEqual(OK);
    expect(await payCreditExpense(owner, pay(o.power, { amountCentimes: "1" }), clock)).toEqual({ ok: false, error: "NOTHING_OWED" });
    expect(await paymentsOf(o.power)).toBe(2);
    const audited = await db.auditEvent.findFirstOrThrow({ where: { organizationId: owner.organizationId, entity: "Expense", entityId: o.power, action: "pay" }, orderBy: { id: "asc" } });
    expect(audited.after).toMatchObject({ paymentId: first.id, amountCentimes: "100000", paidWith: "cash", treasuryId: o.box, account: "4411" });
    const list = await creditExpensesToPay(owner);
    expect(list.ok && list.value.map((e) => e.expenseId)).toEqual([o.water]); // paid off: off the list
  });

  it("names the expense's day when it has no note", async () => {
    const p = pay(o.water, { amountCentimes: "5000", paidWith: "transfer", treasuryId: o.bank });
    expect(await payCreditExpense(owner, p, clock)).toEqual(OK);
    expect(await linesOf(`expense:${o.water}:pay:${p.id}`)).toEqual([
      ["BQ", "2026-04-10", "4411", 5_000n, 0n, null],
      ["BQ", "2026-04-10", "5141", 0n, 5_000n, o.bank],
    ]);
    expect((await db.journalEntry.findFirstOrThrow({ where: { sourceId: `expense:${o.water}:pay:${p.id}` } })).label).toBe("Paiement fournisseur : dépense du 04/03/2026");
  });

  it("refuses, writing nothing: paid in cash, the wrong kind of account, another's account, a future day, a locked month, bad input", async () => {
    const entries = () => db.journalEntry.count({ where: { organizationId: owner.organizationId } });
    const before = await entries();
    expect(await payCreditExpense(owner, pay(o.cash), clock)).toEqual({ ok: false, error: "NOTHING_OWED" });
    expect(await payCreditExpense(owner, pay(o.water, { treasuryId: o.bank }), clock)).toEqual({ ok: false, error: "TREASURY_ACCOUNT_MISMATCH" });
    expect(await payCreditExpense(owner, pay(o.water, { paidWith: "transfer", treasuryId: o.box }), clock)).toEqual({ ok: false, error: "TREASURY_ACCOUNT_MISMATCH" });
    expect(await payCreditExpense(owner, pay(o.water, { treasuryId: x.box }), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await payCreditExpense(owner, pay(o.water, { day: "2026-06-17" }), clock)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(await payCreditExpense(owner, pay(o.water, { amountCentimes: "0" }), clock)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await payCreditExpense(owner, pay(o.water, { paidWith: "credit" }), clock)).toEqual({ ok: false, error: "INVALID_INPUT" });
    const entity = (await listLegalEntities(owner))[0].id;
    expect(await setPeriodLocked(owner, entity, "2026-05", true)).toEqual(OK);
    expect(await payCreditExpense(owner, pay(o.water, { day: "2026-05-20" }), clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await setPeriodLocked(owner, entity, "2026-05", false)).toEqual(OK);
    expect(await entries()).toBe(before);
  });

  it("takes two payments at once one after the other: both capped by the same debt", async () => {
    const both = await Promise.all([1, 2].map(() => payCreditExpense(other, pay(x.power, { amountCentimes: "120000" }), clock).catch((e) => e)));
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.filter((r) => !r.ok)).toEqual([{ ok: false, error: "NOTHING_OWED" }]);
    expect(await paymentsOf(x.power)).toBe(1);
  });

  it("is the owner's and the manager's; the accountant and workers neither list nor pay", async () => {
    const manager = { ...owner, role: "manager" as const };
    expect(await payCreditExpense(manager, pay(o.water, { amountCentimes: "5000" }), clock)).toEqual(OK);
    expect((await creditExpensesToPay(manager)).ok).toBe(true);
    for (const role of ["accountant", "worker", "vet"] as const) {
      const ctx = { ...owner, role };
      expect(await payCreditExpense(ctx, pay(o.water), clock), role).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await creditExpensesToPay(ctx), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
  });

  it("keeps each organisation to its own expenses", async () => {
    const before = await paymentsOf(o.water);
    expect(await payCreditExpense(other, pay(o.water), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await paymentsOf(o.water)).toBe(before);
    const theirs = await creditExpensesToPay(other);
    expect(theirs.ok && theirs.value.map((e) => e.expenseId)).toEqual([x.water]); // x.power paid off above
  });
});
