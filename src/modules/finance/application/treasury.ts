import { v7 as uuidv7 } from "uuid";
import type { z } from "zod";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { batchFacts } from "@/modules/flock";
import { postEntry, type PostError } from "@/modules/finance/application/ledger";
import { monthPeriod } from "@/modules/finance/domain/batch";
import { firstOpenMonth, monthOf } from "@/modules/finance/domain/entry";
import type { Posting } from "@/modules/finance/domain/posting";
import { expensePosting, transferPostings, type ExpenseCategory, type TreasuryKind } from "@/modules/finance/domain/treasury";
import { lockedMonths } from "@/modules/finance/infrastructure/ledger";
import type { CreateTreasuryAccount, ExpenseDto, RecordExpense, RecordTransfer, TransferDto, TreasuryAccountDto } from "@/modules/finance/schema";

type Meta = { mutationId: string; deviceCreatedAt: Date };
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const inFuture = (day: string, clock: Clock) => daysBetween(day as FarmDay, nextFarmDay(farmDayOf(clock.now()))) < 0; // a phone may run a little ahead

/** FN3, applied by the sync push: a bank account or cash box (owner, manager). */
export async function createTreasuryAccount(tx: Tx, ctx: TenantContext, cmd: z.output<typeof CreateTreasuryAccount>, meta: Meta) {
  if ((await tx.treasuryAccount.count({ where: { id: cmd.id } })) > 0) return fail("ALREADY_EXISTS");
  const account: TreasuryAccountDto = cmd;
  await tx.treasuryAccount.create({ data: { ...account, organizationId: ctx.organizationId } });
  await recordChange(tx, ctx, "treasuryAccount", account.id, account);
  await audit(tx, ctx, { entity: "TreasuryAccount", entityId: account.id, action: "create", after: account, ...meta });
  return ok(undefined);
}

const treasuryOf = (tx: Tx, ctx: TenantContext, id: string) =>
  tx.treasuryAccount.findFirst({ where: { id, organizationId: ctx.organizationId } }).then((a) => a && { id: a.id, kind: a.kind as TreasuryKind });

/** Posts a farm-side record's entries in the same transaction, into the first open month when its month is locked. */
async function postNow(tx: Tx, ctx: TenantContext, sourceId: string, day: string, postings: Posting[]): Promise<Result<void, PostError>> {
  const [entity] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation in M1
  if (!entity) return fail("NOT_FOUND");
  const locked = await lockedMonths(tx, ctx, entity.id);
  const onDay = (locked.has(monthOf(day as FarmDay)) ? `${firstOpenMonth(monthOf(day as FarmDay), locked)}-01` : day) as FarmDay;
  for (const [i, p] of postings.entries()) {
    const posted = await postEntry(tx, ctx, { id: uuidv7(), legalEntityId: entity.id, journal: p.journal, day: onDay, label: p.label, reversesId: null, lines: p.lines, source: { module: "finance", id: sourceId, version: i + 1 } });
    if (!posted.ok) return posted;
  }
  return ok(undefined);
}

/**
 * FX4, FN6, applied by the sync push: a quick expense recorded on the phone (owner, manager), posted once when it
 * arrives (its id is the source key). Paid from one of the organisation's cash boxes or bank accounts, or on credit.
 */
export async function recordExpense(tx: Tx, ctx: TenantContext, cmd: z.output<typeof RecordExpense>, meta: Meta, clock: Clock = systemClock) {
  if ((await tx.expense.count({ where: { id: cmd.id } })) > 0) return fail("ALREADY_EXISTS");
  if (inFuture(cmd.day, clock)) return fail("DAY_IN_FUTURE");
  if (cmd.treasuryId) {
    const t = await treasuryOf(tx, ctx, cmd.treasuryId);
    if (!t) return fail("NOT_FOUND");
    if (t.kind !== cmd.paidFrom) return fail("INVALID_INPUT"); // a cash box for cash, a bank account for the bank
  }
  if (cmd.batchId && !(await batchFacts(tx, ctx, cmd.batchId))) return fail("NOT_FOUND"); // another organisation's batch
  const expense: ExpenseDto = {
    ...cmd,
    category: cmd.category as ExpenseDto["category"],
    treasuryId: cmd.paidFrom === "credit" ? null : cmd.treasuryId,
    serviceMonth: cmd.batchId ? null : cmd.serviceMonth, // a direct charge has no service period to share over
  };
  const period = expense.serviceMonth ? monthPeriod(expense.serviceMonth) : null;
  await tx.expense.create({
    data: {
      id: expense.id,
      organizationId: ctx.organizationId,
      day: date(expense.day),
      category: expense.category,
      amountCentimes: BigInt(expense.amountCentimes),
      paidFrom: expense.paidFrom,
      treasuryId: expense.treasuryId,
      note: expense.note,
      batchId: expense.batchId ?? null,
      shared: period !== null,
      serviceFrom: period && date(period.from),
      serviceTo: period && date(period.to),
      recordedBy: ctx.userId,
    },
  });
  const posted = await postNow(tx, ctx, expense.id, expense.day, [
    expensePosting({ category: expense.category as ExpenseCategory, amount: BigInt(expense.amountCentimes), paidFrom: expense.paidFrom, treasuryId: expense.treasuryId }),
  ]);
  if (!posted.ok) return posted; // the push rolls the expense back with it
  await recordChange(tx, ctx, "expense", expense.id, expense);
  await audit(tx, ctx, { entity: "Expense", entityId: expense.id, action: "create", after: expense, ...meta });
  return ok(undefined);
}

/** FN6, applied by the sync push: cash deposited in the bank, cash withdrawn, or between two accounts, through 5115. */
export async function recordTransfer(tx: Tx, ctx: TenantContext, cmd: z.output<typeof RecordTransfer>, meta: Meta, clock: Clock = systemClock) {
  if ((await tx.treasuryTransfer.count({ where: { id: cmd.id } })) > 0) return fail("ALREADY_EXISTS");
  if (inFuture(cmd.day, clock)) return fail("DAY_IN_FUTURE");
  if (cmd.fromId === cmd.toId) return fail("INVALID_INPUT");
  const [from, to] = await Promise.all([treasuryOf(tx, ctx, cmd.fromId), treasuryOf(tx, ctx, cmd.toId)]);
  if (!from || !to) return fail("NOT_FOUND");
  const transfer: TransferDto = cmd;
  await tx.treasuryTransfer.create({ data: { ...transfer, organizationId: ctx.organizationId, day: date(transfer.day), amountCentimes: BigInt(transfer.amountCentimes), recordedBy: ctx.userId } });
  const posted = await postNow(tx, ctx, transfer.id, transfer.day, transferPostings({ amount: BigInt(transfer.amountCentimes), from, to }));
  if (!posted.ok) return posted;
  await recordChange(tx, ctx, "transfer", transfer.id, transfer);
  await audit(tx, ctx, { entity: "TreasuryTransfer", entityId: transfer.id, action: "create", after: transfer, ...meta });
  return ok(undefined);
}

export type TreasuryOverview = {
  accounts: { id: string; kind: TreasuryKind; name: string; balanceCentimes: bigint }[];
  movements: { day: string; journal: string; label: string; account: string; treasuryId: string | null; debitCentimes: bigint; creditCentimes: bigint }[];
};

/** FN10: each bank account's and cash box's balance, and this month's movements on 5141 / 5161 (owner, manager). */
export async function treasuryOverview(ctx: TenantContext, month: string): Promise<Result<TreasuryOverview, "FORBIDDEN" | "INVALID_INPUT">> {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail("INVALID_INPUT");
  const org = { organizationId: ctx.organizationId };
  const [accounts, balances, lines] = await Promise.all([
    db.treasuryAccount.findMany({ where: org, orderBy: { name: "asc" } }),
    db.journalLine.groupBy({ by: ["treasuryId"], where: { ...org, treasuryId: { not: null } }, _sum: { debitCentimes: true, creditCentimes: true } }),
    db.journalLine.findMany({
      where: { ...org, account: { in: ["5141", "5161"] }, entry: { day: { gte: date(`${month}-01`), lt: date(nextMonth(month)) } } },
      include: { entry: { select: { day: true, journal: true, label: true } } },
      orderBy: [{ entry: { day: "asc" } }, { entry: { createdAt: "asc" } }],
    }),
  ]);
  const balance = new Map(balances.map((x) => [x.treasuryId, (x._sum.debitCentimes ?? 0n) - (x._sum.creditCentimes ?? 0n)]));
  return ok({
    accounts: accounts.map((x) => ({ id: x.id, kind: x.kind as TreasuryKind, name: x.name, balanceCentimes: balance.get(x.id) ?? 0n })),
    movements: lines.map((l) => ({
      day: l.entry.day.toISOString().slice(0, 10),
      journal: l.entry.journal,
      label: l.entry.label,
      account: l.account,
      treasuryId: l.treasuryId,
      debitCentimes: l.debitCentimes,
      creditCentimes: l.creditCentimes,
    })),
  });
}

const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};
