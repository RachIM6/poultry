import type { Tx } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import type { Line } from "@/modules/finance/domain/entry";
import type { AccountRow } from "@/modules/finance/schema";
import type { Journal } from "@/generated/prisma/client";

export type EntryRow = {
  id: string;
  legalEntityId: string;
  journal: Journal;
  day: FarmDay;
  label: string;
  reversesId: string | null;
  lines: Line[];
  source?: { module: string; id: string; version: number };
};

const date = (day: FarmDay) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10) as FarmDay;

// shortcut: reads the whole chart each time (59 rows), cache it per process if posting volume grows.
export async function ledgerAccounts(tx: Tx): Promise<AccountRow[]> {
  const rows = await tx.ledgerAccount.findMany();
  return rows.map((r) => ({ chart: r.chart as AccountRow["chart"], number: r.number, label: r.label, parent: r.parentNumber, fallback: r.fallback }));
}

export async function lockedMonths(tx: Tx, ctx: TenantContext, legalEntityId: string): Promise<Set<string>> {
  const rows = await tx.lockedPeriod.findMany({ where: { organizationId: ctx.organizationId, legalEntityId }, select: { month: true } });
  return new Set(rows.map((r) => r.month));
}

export async function entryExists(tx: Tx, id: string) {
  return (await tx.journalEntry.count({ where: { id } })) > 0;
}

export async function saveEntry(tx: Tx, ctx: TenantContext, e: EntryRow) {
  await tx.journalEntry.create({
    data: {
      id: e.id,
      organizationId: ctx.organizationId,
      legalEntityId: e.legalEntityId,
      journal: e.journal,
      day: date(e.day),
      label: e.label,
      reversesId: e.reversesId,
      sourceModule: e.source?.module,
      sourceId: e.source?.id,
      sourceVersion: e.source?.version,
      createdBy: ctx.userId,
    },
  });
  await tx.journalLine.createMany({
    data: e.lines.map((l) => ({ organizationId: ctx.organizationId, entryId: e.id, account: l.account, debitCentimes: l.debit, creditCentimes: l.credit })),
  });
}

export async function loadEntry(tx: Tx, ctx: TenantContext, id: string): Promise<(EntryRow & { reversed: boolean }) | null> {
  const e = await tx.journalEntry.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { lines: true } });
  if (!e) return null;
  const reversed = (await tx.journalEntry.count({ where: { reversesId: id } })) > 0;
  return {
    id: e.id,
    legalEntityId: e.legalEntityId,
    journal: e.journal,
    day: dayOf(e.day),
    label: e.label,
    reversesId: e.reversesId,
    lines: e.lines.map((l) => ({ account: l.account, debit: l.debitCentimes, credit: l.creditCentimes })),
    reversed,
  };
}

/** Σdebit − Σcredit per account over [from, to], for one legal entity. */
export async function balancesBetween(tx: Tx, ctx: TenantContext, legalEntityId: string, from: FarmDay, to: FarmDay): Promise<Map<string, bigint>> {
  const rows = await tx.$queryRaw<{ account: string; balance: bigint }[]>`
    SELECT l.account, sum(l."debitCentimes" - l."creditCentimes")::bigint AS balance
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE e."organizationId" = ${ctx.organizationId}::uuid AND e."legalEntityId" = ${legalEntityId}::uuid
      AND e.day BETWEEN ${from}::date AND ${to}::date
    GROUP BY l.account`;
  return new Map(rows.map((r) => [r.account, r.balance]));
}

export async function entriesBetween(tx: Tx, ctx: TenantContext, legalEntityId: string, from: FarmDay, to: FarmDay) {
  return tx.journalEntry.count({ where: { organizationId: ctx.organizationId, legalEntityId, day: { gte: date(from), lte: date(to) } } });
}

export async function sourceAlreadyPosted(tx: Tx, source: { module: string; id: string; version: number }) {
  return (await tx.journalEntry.count({ where: { sourceModule: source.module, sourceId: source.id, sourceVersion: source.version } })) > 0;
}
