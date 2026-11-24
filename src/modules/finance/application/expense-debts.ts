import { v7 as uuidv7 } from "uuid";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { postEntry } from "@/modules/finance/application/ledger";
import { atomically, type PlacementPayError } from "@/modules/finance/application/placements";
import { treasuryKindOf } from "@/modules/finance/domain/assets";
import { checkPlacementPayment, placementDebt, placementPaymentPosting } from "@/modules/finance/domain/placement-debt";
import type { ExpenseCategory } from "@/modules/finance/domain/treasury";
import { sourceAlreadyPosted } from "@/modules/finance/infrastructure/ledger";
import { CreditExpensePayment } from "@/modules/finance/schema";

// SPEC-finance §9 "Credit expenses": a quick expense recorded on credit (C 4411, FN6) is paid later from /treasury, as
// a placement's chicks are (placements.ts): same cap, same posting, its own source `expense:<expense>:pay:<payment>`.

const inFuture = (day: string, clock: Clock) => daysBetween(day as FarmDay, nextFarmDay(farmDayOf(clock.now()))) < 0;
const paymentsOf = (expenseId: string) => `expense:${expenseId}:pay:`;
const dayOf = (d: Date) => d.toISOString().slice(0, 10) as FarmDay;

export type CreditExpense = { expenseId: string; day: FarmDay; category: ExpenseCategory; note: string | null; account: string; owed: bigint };

/**
 * The credit expenses with what each still owes: the credit of its entry (posted with it, FN6) less the payments posted
 * for it. All of the organisation's when `ids` is absent, oldest first.
 * ponytail: reads every credit expense of the organisation; filter by fiscal year if the list grows slow.
 */
async function creditExpenses(tx: Tx, ctx: TenantContext, ids?: string[]): Promise<CreditExpense[]> {
  const org = ctx.organizationId;
  const expenses = await tx.expense.findMany({
    where: { organizationId: org, paidFrom: "credit", ...(ids && { id: { in: ids } }) },
    select: { id: true, day: true, category: true, note: true },
    orderBy: [{ day: "asc" }, { id: "asc" }],
  });
  const [entries, payments] = await Promise.all([
    tx.journalEntry.findMany({
      where: { organizationId: org, sourceModule: "finance", sourceId: { in: expenses.map((e) => e.id) } },
      select: { id: true, sourceId: true, sourceVersion: true, lines: { select: { account: true, debitCentimes: true, creditCentimes: true } } },
    }),
    tx.journalLine.findMany({
      where: { organizationId: org, debitCentimes: { gt: 0n }, entry: { sourceModule: "finance", OR: expenses.map((e) => ({ sourceId: { startsWith: paymentsOf(e.id) } })) } },
      select: { debitCentimes: true, entry: { select: { sourceId: true } } },
    }),
  ]);
  const paid = new Map<string, bigint>();
  for (const l of payments) {
    const id = l.entry.sourceId!.split(":")[1];
    paid.set(id, (paid.get(id) ?? 0n) + l.debitCentimes);
  }
  const byExpense = Map.groupBy(entries, (e) => e.sourceId!);
  // An expense's entry is never reversed (no edit, FN5 reverses manual entries only).
  return expenses.flatMap((e) => {
    const es = (byExpense.get(e.id) ?? []).map((x) => ({ id: x.id, version: x.sourceVersion ?? 0, lines: x.lines.map((l) => ({ account: l.account, debit: l.debitCentimes, credit: l.creditCentimes })) }));
    const debt = placementDebt(es, new Set(), paid.get(e.id) ?? 0n);
    return debt ? [{ expenseId: e.id, day: dayOf(e.day), category: e.category as ExpenseCategory, note: e.note, account: debt.account, owed: debt.owed }] : [];
  });
}

/**
 * The owner or the manager pays a credit expense: D the account its entry credited (4411) / C 5161 or 5141, at most
 * what is still owed for it. Online, audited, the id from the form (the same form twice posts once). A locked month
 * refuses it (FN5).
 */
export async function payCreditExpense(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<void, PlacementPayError>> {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  const parsed = CreditExpensePayment.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const p = parsed.data;
  if (inFuture(p.day, clock)) return fail("DAY_IN_FUTURE");
  const [entity] = await listLegalEntities(ctx);
  if (!entity) return fail("NOT_FOUND");
  const source = { module: "finance", id: `${paymentsOf(p.expenseId)}${p.id}`, version: 1 };
  return atomically(async (tx): Promise<Result<void, PlacementPayError>> => {
    // Two payments of one expense at once: one after the other, so both are capped by the same debt.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${p.expenseId}, 8))`;
    if (!(await tx.expense.count({ where: { id: p.expenseId, organizationId: ctx.organizationId } }))) return fail("NOT_FOUND"); // another organisation's
    if (await sourceAlreadyPosted(tx, ctx, source)) return ok(undefined); // a retry
    const amount = BigInt(p.amountCentimes);
    const [expense] = await creditExpenses(tx, ctx, [p.expenseId]);
    const debt = checkPlacementPayment(expense ?? null, amount); // paid in cash or at the bank: nothing owed
    if (!debt.ok) return debt;
    if (p.treasuryId) {
      const account = await tx.treasuryAccount.findFirst({ where: { id: p.treasuryId, organizationId: ctx.organizationId }, select: { kind: true } });
      if (!account) return fail("NOT_FOUND");
      if (account.kind !== treasuryKindOf(p.paidWith)) return fail("TREASURY_ACCOUNT_MISMATCH");
    }
    const party = expense.note ?? `dépense du ${expense.day.split("-").reverse().join("/")}`; // no supplier on a quick expense
    const posting = placementPaymentPosting(debt.value, amount, p.paidWith, p.treasuryId, party);
    const posted = await postEntry(tx, ctx, { id: uuidv7(), legalEntityId: entity.id, journal: posting.journal, day: p.day as FarmDay, label: posting.label, reversesId: null, lines: posting.lines, source });
    if (!posted.ok) return posted;
    await audit(tx, ctx, { entity: "Expense", entityId: p.expenseId, action: "pay", after: { paymentId: p.id, day: p.day, amountCentimes: p.amountCentimes, paidWith: p.paidWith, treasuryId: p.treasuryId, account: debt.value.account } });
    return ok(undefined);
  });
}

/** The credit expenses still owed, oldest first (the payer's list). */
export async function creditExpensesToPay(ctx: TenantContext): Promise<Result<CreditExpense[], "FORBIDDEN">> {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  return ok((await creditExpenses(db, ctx)).filter((e) => e.owed > 0n));
}


/** F-Effects: what the credit expenses still owe, due on their own day (a quick expense has no due date). */
export async function creditExpenseDues(ctx: TenantContext): Promise<{ dueOn: string; amountCentimes: bigint }[]> {
  return (await creditExpenses(db, ctx)).filter((e) => e.owed > 0n).map((e) => ({ dueOn: e.day, amountCentimes: e.owed }));
}
