import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { addBankStatement, bankReconciliation, matchBankLine, setPeriodLocked } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-10T08:00:00+01:00" });
const applied = async (ctx: TenantContext, ...ms: ReturnType<typeof m>[]) => expect((await push(ctx, ms, registry)).results.map((r) => r.status)).toEqual(ms.map(() => "applied"));
const read = async (ctx: TenantContext, account?: string, statement?: string) => {
  const r = await bankReconciliation(ctx, account, statement);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("bank reconciliation, manual matching (SPEC-finance FC9, FCX1, T111)", () => {
  let a: TenantContext, b: TenantContext;
  const box = uuidv7();
  const bank = uuidv7();
  let march: string; // the statement to 14 March
  const lineOf = async (sourceId: string) => (await db.journalLine.findFirstOrThrow({ where: { account: "5141", entry: { sourceId } } })).id;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [a, b] = await twoTenants();
    await applied(a, m("finance.createTreasuryAccount", { id: box, kind: "cash", name: "Caisse ferme" }), m("finance.createTreasuryAccount", { id: bank, kind: "bank", name: "Banque Populaire" }));
    // Two weeks of the bank account, booked through the existing forms (T32): 1–14 March, then one line after.
    const expense = (key: string, day: string, category: string, amountCentimes: string) => {
      ids[key] = uuidv7();
      return m("finance.recordExpense", { id: ids[key], day, category, amountCentimes, paidFrom: "bank", treasuryId: bank, note: null });
    };
    const transfer = (key: string, day: string, amountCentimes: string, fromId: string, toId: string) => {
      ids[key] = uuidv7();
      return m("finance.recordTransfer", { id: ids[key], day, amountCentimes, fromId, toId });
    };
    await applied(
      a,
      transfer("deposit", "2026-03-02", "5000000", box, bank), // + 50 000,00
      expense("power", "2026-03-05", "electricity", "120000"), // − 1 200,00
      expense("water", "2026-03-09", "water", "30000"), // − 300,00
      transfer("withdrawal", "2026-03-12", "500000", bank, box), // − 5 000,00
      expense("insurance", "2026-03-13", "insurance", "80000"), // − 800,00: a cheque the bank hasn't cashed by the 14th
      expense("later", "2026-03-16", "catching", "10000"), // after the statement
    );
    for (const k of Object.keys(ids)) ids[k] = await lineOf(ids[k]);
  });

  it("two-week fixture: ticking the statement's lines, all in the books, brings the difference to 0", async () => {
    const added = await addBankStatement(a, { treasuryId: bank, endDay: "2026-03-14", closingCentimes: "4350000" }); // 43 500,00 printed
    if (!added.ok) throw new Error(added.error);
    march = added.value;
    const before = (await read(a)).statement!;
    expect(before).toMatchObject({ closingCentimes: 4_350_000n, bookCentimes: 4_270_000n, tickedCentimes: 0n, differenceCentimes: 4_350_000n, reconciled: false });
    expect(before.lines.map((l) => l.id)).toEqual([ids.deposit, ids.power, ids.water, ids.withdrawal, ids.insurance]); // not the 16th

    for (const k of ["deposit", "power", "water", "withdrawal"]) expect(await matchBankLine(a, { statementId: march, lineId: ids[k], ticked: true })).toEqual({ ok: true, value: undefined });
    const after = (await read(a, bank, march)).statement!;
    expect(after).toMatchObject({ bookCentimes: 4_270_000n, tickedCentimes: 4_350_000n, differenceCentimes: 0n, reconciled: true });
    expect(after.lines.filter((l) => !l.ticked).map((l) => l.id)).toEqual([ids.insurance]);
  });

  it("ticks a line on one statement at most, in the database too, and only up to the end day", async () => {
    const april = await addBankStatement(a, { treasuryId: bank, endDay: "2026-03-31", closingCentimes: "4260000" });
    if (!april.ok) throw new Error(april.error);
    expect(await addBankStatement(a, { treasuryId: bank, endDay: "2026-03-31", closingCentimes: "1" })).toEqual({ ok: false, error: "ALREADY_EXISTS" });
    expect(await matchBankLine(a, { statementId: april.value, lineId: ids.power, ticked: true })).toEqual({ ok: false, error: "LINE_ALREADY_TICKED" });
    await expect(db.bankMatch.create({ data: { journalLineId: ids.power, organizationId: a.organizationId, statementId: april.value, tickedBy: a.userId } })).rejects.toThrow();
    expect(await matchBankLine(a, { statementId: march, lineId: ids.later, ticked: true })).toEqual({ ok: false, error: "LINE_AFTER_STATEMENT" });

    // Two ticks of the same line at once, on two statements: one wins.
    const both = await Promise.all([march, april.value].map((statementId) => matchBankLine(a, { statementId, lineId: ids.insurance, ticked: true })));
    expect(both.map((r) => (r.ok ? "ok" : r.error)).sort()).toEqual(["LINE_ALREADY_TICKED", "ok"]);
    expect(await db.bankMatch.count({ where: { journalLineId: ids.insurance } })).toBe(1);
    const winner = (await db.bankMatch.findUniqueOrThrow({ where: { journalLineId: ids.insurance } })).statementId;
    expect(await matchBankLine(a, { statementId: winner, lineId: ids.insurance, ticked: false })).toEqual({ ok: true, value: undefined });

    // A line ticked on the later statement shows on the earlier one as unticked, with where it was ticked.
    expect(await matchBankLine(a, { statementId: april.value, lineId: ids.insurance, ticked: true })).toEqual({ ok: true, value: undefined });
    const early = (await read(a, bank, march)).statement!;
    expect(early.lines.find((l) => l.id === ids.insurance)).toMatchObject({ ticked: false, tickedOn: "2026-03-31" });
    expect((await read(a, bank, april.value)).statement).toMatchObject({ tickedCentimes: -80_000n, bookCentimes: 4_260_000n, differenceCentimes: -10_000n }); // the 16th is at the bank, not ticked yet
  });

  it("refuses ticking and unticking once the line's month is locked, and audits every tick", async () => {
    const entity = await db.legalEntity.findFirstOrThrow({ where: { organizationId: a.organizationId } });
    expect(await setPeriodLocked(a, entity.id, "2026-03", true)).toEqual({ ok: true, value: undefined });
    expect(await matchBankLine(a, { statementId: march, lineId: ids.power, ticked: false })).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    const april = (await read(a)).statements[0].id;
    expect(await matchBankLine(a, { statementId: april, lineId: ids.later, ticked: true })).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await setPeriodLocked(a, entity.id, "2026-03", false)).toEqual({ ok: true, value: undefined });
    expect(await matchBankLine(a, { statementId: march, lineId: ids.power, ticked: false })).toEqual({ ok: true, value: undefined });
    expect(await matchBankLine(a, { statementId: march, lineId: ids.power, ticked: false })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await matchBankLine(a, { statementId: march, lineId: ids.power, ticked: true })).toEqual({ ok: true, value: undefined });

    const events = await db.auditEvent.findMany({ where: { organizationId: a.organizationId, entity: "BankMatch" }, orderBy: [{ serverReceivedAt: "asc" }, { id: "asc" }] });
    expect(events.map((e) => e.action)).toEqual(["tick", "tick", "tick", "tick", "tick", "untick", "tick", "untick", "tick"]);
    expect(events.at(-2)).toMatchObject({ entityId: ids.power, userId: a.userId, before: { statementId: march, lineId: ids.power, day: "2026-03-05", amountCentimes: "-120000" }, after: null });
    expect(await db.auditEvent.count({ where: { organizationId: a.organizationId, entity: "BankStatement", action: "create" } })).toBe(2);
  });

  it("lets the owner and a manager write, the accountant read, and refuses workers and other organisations", async () => {
    const manager = { ...a, role: "manager" as const };
    const accountant = { ...a, role: "accountant" as const };
    const worker = { ...a, role: "worker" as const };
    expect(await matchBankLine(manager, { statementId: march, lineId: ids.power, ticked: false })).toEqual({ ok: true, value: undefined });
    expect(await matchBankLine(manager, { statementId: march, lineId: ids.power, ticked: true })).toEqual({ ok: true, value: undefined });
    expect((await addBankStatement(manager, { treasuryId: bank, endDay: "2026-03-07", closingCentimes: "4880000" })).ok).toBe(true);

    expect(await read(accountant, bank, march)).toMatchObject({ canWrite: false, statement: { reconciled: true } });
    expect(await matchBankLine(accountant, { statementId: march, lineId: ids.power, ticked: false })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await addBankStatement(accountant, { treasuryId: bank, endDay: "2026-03-08", closingCentimes: "0" })).toEqual({ ok: false, error: "FORBIDDEN" });

    expect(await bankReconciliation(worker)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await matchBankLine(worker, { statementId: march, lineId: ids.power, ticked: false })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await addBankStatement(worker, { treasuryId: bank, endDay: "2026-03-08", closingCentimes: "0" })).toEqual({ ok: false, error: "FORBIDDEN" });

    expect(await read(b, bank, march)).toEqual({ canWrite: true, accounts: [], account: null, statements: [], statement: null });
    expect(await matchBankLine(b, { statementId: march, lineId: ids.power, ticked: false })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await addBankStatement(b, { treasuryId: bank, endDay: "2026-03-08", closingCentimes: "0" })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await addBankStatement(a, { treasuryId: box, endDay: "2026-03-08", closingCentimes: "0" })).toEqual({ ok: false, error: "NOT_FOUND" }); // a cash box has no statement
    expect(await db.bankMatch.count({ where: { journalLineId: ids.power } })).toBe(1);
  });

  it("refuses a statement ending in the future or with an amount that isn't integer centimes", async () => {
    const clock = { now: () => new Date("2026-03-20T12:00:00Z") };
    expect(await addBankStatement(a, { treasuryId: bank, endDay: "2026-03-21", closingCentimes: "0" }, clock)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(await addBankStatement(a, { treasuryId: bank, endDay: "2026-03-20", closingCentimes: "12.5" }, clock)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect((await addBankStatement(a, { treasuryId: bank, endDay: "2026-03-20", closingCentimes: "-150000" }, clock)).ok).toBe(true); // overdrawn
  });
});
