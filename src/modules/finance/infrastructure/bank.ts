import type { Tx } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import type { BankLine, Statement } from "@/modules/finance/domain/bank";

// SPEC-finance FC9: statements and ticks of an organisation's bank accounts. Every read and write is scoped by ctx.

const BANK = "5141";
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10) as FarmDay;
const toStatement = (s: { id: string; endDay: Date; closingCentimes: bigint; treasuryId: string }) => ({ id: s.id, treasuryId: s.treasuryId, endDay: dayOf(s.endDay), closingCentimes: s.closingCentimes });

export const bankAccountsOf = (tx: Tx, ctx: TenantContext) =>
  tx.treasuryAccount.findMany({ where: { organizationId: ctx.organizationId, kind: "bank" }, orderBy: { name: "asc" }, select: { id: true, name: true } });

export const statementsOf = async (tx: Tx, ctx: TenantContext, treasuryId: string): Promise<(Statement & { treasuryId: string })[]> =>
  (await tx.bankStatement.findMany({ where: { organizationId: ctx.organizationId, treasuryId }, orderBy: { endDay: "desc" } })).map(toStatement);

export async function statementIn(tx: Tx, ctx: TenantContext, id: string) {
  const s = await tx.bankStatement.findFirst({ where: { id, organizationId: ctx.organizationId } });
  return s && toStatement(s);
}

/** False when the account already has a statement ending that day (the unique key, also under a race). */
export async function saveStatement(tx: Tx, ctx: TenantContext, s: Statement & { treasuryId: string }) {
  const { count } = await tx.bankStatement.createMany({
    data: [{ id: s.id, organizationId: ctx.organizationId, treasuryId: s.treasuryId, endDay: date(s.endDay), closingCentimes: s.closingCentimes, createdBy: ctx.userId }],
    skipDuplicates: true,
  });
  return count === 1;
}

const lineSelect = {
  id: true,
  debitCentimes: true,
  creditCentimes: true,
  entry: { select: { day: true, journal: true, label: true, legalEntityId: true } },
  bankMatch: { select: { statementId: true, statement: { select: { endDay: true } } } },
} as const;

type LineRow = { id: string; debitCentimes: bigint; creditCentimes: bigint; entry: { day: Date; journal: string; label: string; legalEntityId: string }; bankMatch: { statementId: string; statement: { endDay: Date } } | null };
const toLine = (l: LineRow): BankLine & { journal: string; label: string; legalEntityId: string; debitCentimes: bigint; creditCentimes: bigint } => ({
  id: l.id,
  day: dayOf(l.entry.day),
  amount: l.debitCentimes - l.creditCentimes,
  match: l.bankMatch && { statementId: l.bankMatch.statementId, endDay: dayOf(l.bankMatch.statement.endDay) },
  journal: l.entry.journal,
  label: l.entry.label,
  legalEntityId: l.entry.legalEntityId,
  debitCentimes: l.debitCentimes,
  creditCentimes: l.creditCentimes,
});

/** The account's 5141 lines up to `upTo` included, in day order, with the statement each is ticked on. */
export async function bankLinesUpTo(tx: Tx, ctx: TenantContext, treasuryId: string, upTo: FarmDay) {
  const rows = await tx.journalLine.findMany({
    where: { organizationId: ctx.organizationId, account: BANK, treasuryId, entry: { day: { lte: date(upTo) } } },
    select: lineSelect,
    orderBy: [{ entry: { day: "asc" } }, { entry: { createdAt: "asc" } }, { id: "asc" }],
  });
  return rows.map(toLine);
}

export async function bankLineIn(tx: Tx, ctx: TenantContext, treasuryId: string, id: string) {
  const l = await tx.journalLine.findFirst({ where: { id, organizationId: ctx.organizationId, account: BANK, treasuryId }, select: lineSelect });
  return l && toLine(l);
}

/** False when the line is already ticked on a statement (the key on the line, also under a race). */
export async function saveMatch(tx: Tx, ctx: TenantContext, statementId: string, lineId: string) {
  const { count } = await tx.bankMatch.createMany({ data: [{ journalLineId: lineId, organizationId: ctx.organizationId, statementId, tickedBy: ctx.userId }], skipDuplicates: true });
  return count === 1;
}

export const deleteMatch = (tx: Tx, ctx: TenantContext, statementId: string, lineId: string) =>
  tx.bankMatch.deleteMany({ where: { journalLineId: lineId, statementId, organizationId: ctx.organizationId } });

// T117: the lines of an imported statement file.

export async function statementOn(tx: Tx, ctx: TenantContext, treasuryId: string, endDay: FarmDay) {
  const s = await tx.bankStatement.findFirst({ where: { organizationId: ctx.organizationId, treasuryId, endDay: date(endDay) } });
  return s && toStatement(s);
}

export const importedHashesOf = async (tx: Tx, ctx: TenantContext, statementId: string) =>
  (await tx.bankStatementLine.findMany({ where: { organizationId: ctx.organizationId, statementId }, select: { hash: true } })).map((l) => l.hash);

type ImportedRow = { id: string; day: FarmDay; amountCentimes: bigint; label: string; reference: string; hash: string };

/** Lines already there (same statement and hash) are skipped, also under a race: the count is of the new ones. */
export async function saveImportedLines(tx: Tx, ctx: TenantContext, statementId: string, rows: readonly ImportedRow[]) {
  const { count } = await tx.bankStatementLine.createMany({ data: rows.map((r) => ({ ...r, day: date(r.day), organizationId: ctx.organizationId, statementId })), skipDuplicates: true });
  return count;
}

export const importedLinesOf = async (tx: Tx, ctx: TenantContext, statementId: string) =>
  (await tx.bankStatementLine.findMany({ where: { organizationId: ctx.organizationId, statementId }, orderBy: [{ day: "asc" }, { id: "asc" }] })).map((l) => ({ id: l.id, day: dayOf(l.day), amount: l.amountCentimes, label: l.label, reference: l.reference }));
