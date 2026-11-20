import { v7 as uuidv7 } from "uuid";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { checkTick, checkUntick, reconciliation, type MatchError } from "@/modules/finance/domain/bank";
import { bankAccountsOf, bankLineIn, bankLinesUpTo, deleteMatch, saveMatch, saveStatement, statementIn, statementsOf } from "@/modules/finance/infrastructure/bank";
import { lockedMonths } from "@/modules/finance/infrastructure/ledger";
import { AddBankStatement, BankMatchInput } from "@/modules/finance/schema";

// SPEC-finance FC9, FCX1, FCX2: bank reconciliation by manual matching, online. Owner and manager write
// (finance.record); the accountant reads (money.read); workers get nothing.

/** Records a statement as printed: end day (not after today) and closing balance. One per account and end day. */
export async function addBankStatement(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<string, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "DAY_IN_FUTURE" | "ALREADY_EXISTS">> {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  const parsed = AddBankStatement.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { treasuryId, endDay, closingCentimes } = parsed.data;
  if (daysBetween(endDay as FarmDay, farmDayOf(clock.now())) < 0) return fail("DAY_IN_FUTURE");
  return db.$transaction(async (tx) => {
    if (!(await bankAccountsOf(tx, ctx)).some((a) => a.id === treasuryId)) return fail("NOT_FOUND"); // a cash box, or another organisation's
    const statement = { id: uuidv7(), treasuryId, endDay: endDay as FarmDay, closingCentimes: BigInt(closingCentimes) }; // online only: the server's id
    if (!(await saveStatement(tx, ctx, statement))) return fail("ALREADY_EXISTS");
    await audit(tx, ctx, { entity: "BankStatement", entityId: statement.id, action: "create", after: { treasuryId, endDay, closingCentimes } });
    return ok(statement.id);
  });
}

/** Ticks a 5141 line of the statement's account on it, or unticks it. Audited; refused once the line's month is locked. */
export async function matchBankLine(ctx: TenantContext, input: unknown): Promise<Result<void, MatchError | "FORBIDDEN" | "INVALID_INPUT">> {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  const parsed = BankMatchInput.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { statementId, lineId, ticked } = parsed.data;
  return db.$transaction(async (tx) => {
    const statement = await statementIn(tx, ctx, statementId);
    const line = statement && (await bankLineIn(tx, ctx, statement.treasuryId, lineId));
    if (!statement || !line) return fail("NOT_FOUND");
    const locked = await lockedMonths(tx, ctx, line.legalEntityId);
    const checked = (ticked ? checkTick : checkUntick)(line, statement, locked);
    if (!checked.ok) return checked;
    if (ticked && !(await saveMatch(tx, ctx, statementId, lineId))) return fail("LINE_ALREADY_TICKED"); // ticked meanwhile
    if (!ticked && (await deleteMatch(tx, ctx, statementId, lineId)).count === 0) return fail("NOT_FOUND"); // unticked meanwhile
    const tick = { statementId, lineId, day: line.day, amountCentimes: String(line.amount) };
    await audit(tx, ctx, { entity: "BankMatch", entityId: lineId, action: ticked ? "tick" : "untick", before: ticked ? null : tick, after: ticked ? tick : null });
    return ok(undefined);
  });
}

export type BankReconciliation = {
  canWrite: boolean;
  accounts: { id: string; name: string }[];
  account: { id: string; name: string } | null;
  statements: { id: string; endDay: string; closingCentimes: bigint }[];
  statement: {
    id: string;
    endDay: string;
    closingCentimes: bigint;
    bookCentimes: bigint;
    tickedCentimes: bigint;
    differenceCentimes: bigint;
    reconciled: boolean;
    // the lines up to the end day not at the bank before it: ticked on this statement, or not (on a later one: tickedOn)
    lines: { id: string; day: string; journal: string; label: string; debitCentimes: bigint; creditCentimes: bigint; ticked: boolean; tickedOn: string | null }[];
  } | null;
};

/** The screen: the bank accounts, one account's statements (latest first) and one statement's reconciliation. */
export async function bankReconciliation(ctx: TenantContext, accountId?: string, statementId?: string): Promise<Result<BankReconciliation, "FORBIDDEN">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN");
  return db.$transaction(async (tx) => {
    const accounts = await bankAccountsOf(tx, ctx);
    const account = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;
    const statements = account ? await statementsOf(tx, ctx, account.id) : [];
    const s = statements.find((x) => x.id === statementId) ?? statements[0];
    const base = { canWrite: can(ctx, "finance.record"), accounts, account, statements: statements.map(({ id, endDay, closingCentimes }) => ({ id, endDay, closingCentimes })) };
    if (!s) return ok({ ...base, statement: null });
    const lines = await bankLinesUpTo(tx, ctx, s.treasuryId, s.endDay);
    const r = reconciliation(s, lines);
    const unticked = new Set(r.unticked.map((l) => l.id));
    return ok({
      ...base,
      statement: {
        id: s.id,
        endDay: s.endDay,
        closingCentimes: s.closingCentimes,
        bookCentimes: r.bookCentimes,
        tickedCentimes: r.tickedCentimes,
        differenceCentimes: r.differenceCentimes,
        reconciled: r.reconciled,
        lines: lines
          .filter((l) => unticked.has(l.id) || l.match?.statementId === s.id)
          .map((l) => ({ id: l.id, day: l.day, journal: l.journal, label: l.label, debitCentimes: l.debitCentimes, creditCentimes: l.creditCentimes, ticked: l.match?.statementId === s.id, tickedOn: l.match && l.match.statementId !== s.id ? l.match.endDay : null })),
      },
    });
  });
}
