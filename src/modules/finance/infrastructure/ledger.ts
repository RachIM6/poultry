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
    data: e.lines.map((l) => ({ organizationId: ctx.organizationId, entryId: e.id, account: l.account, debitCentimes: l.debit, creditCentimes: l.credit, treasuryId: l.treasuryId ?? null })),
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
    lines: e.lines.map((l) => ({ account: l.account, debit: l.debitCentimes, credit: l.creditCentimes, treasuryId: l.treasuryId })),
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

/** FN7: the source's cursor, row-locked for the rest of the transaction (created at 0 the first time). */
export async function lockCursor(tx: Tx, ctx: TenantContext, source: string): Promise<bigint> {
  await tx.$executeRaw`INSERT INTO "PostingCursor" ("organizationId", source) VALUES (${ctx.organizationId}::uuid, ${source}) ON CONFLICT DO NOTHING`;
  const [{ version }] = await tx.$queryRaw<{ version: bigint }[]>`
    SELECT version FROM "PostingCursor" WHERE "organizationId" = ${ctx.organizationId}::uuid AND source = ${source} FOR UPDATE`;
  return version;
}

export async function moveCursor(tx: Tx, ctx: TenantContext, source: string, version: bigint) {
  await tx.postingCursor.update({ where: { organizationId_source: { organizationId: ctx.organizationId, source } }, data: { version } });
}

/**
 * FN7, §9 "Postings catch up": organisations with a change recorded past a source's cursor, up to `limit`, in random
 * order so a few that keep failing don't hold the others back; `organizationId`: that one only. A tombstone counts: a
 * cancelled sale or purchase reverses its entry (§9 "Cancelled records"), and every source's reader moves past one.
 */
export async function pendingOrganizations(tx: Tx, sources: { name: string; entity: string }[], limit: number, organizationId: string | null = null): Promise<string[]> {
  const rows = await tx.$queryRaw<{ organizationId: string }[]>`
    SELECT v."organizationId" FROM "SyncVersion" v
    WHERE (${organizationId}::uuid IS NULL OR v."organizationId" = ${organizationId}::uuid)
      AND EXISTS (
        SELECT 1 FROM unnest(${sources.map((s) => s.name)}::text[], ${sources.map((s) => s.entity)}::text[]) AS s(source, entity)
        WHERE EXISTS (
          -- the cursor as a subquery, not a join: the index then seeks past it (organizationId, entity, version)
          SELECT 1 FROM "Change" c
          WHERE c."organizationId" = v."organizationId" AND c.entity = s.entity
            AND c.version > COALESCE((SELECT p.version FROM "PostingCursor" p WHERE p."organizationId" = v."organizationId" AND p.source = s.source), 0)))
    ORDER BY random() LIMIT ${limit}`;
  return rows.map((r) => r.organizationId);
}

/** The entry currently standing for a source record: its latest posting that no entry reverses. */
export async function standingEntryFor(tx: Tx, ctx: TenantContext, module: string, sourceId: string) {
  const e = await tx.journalEntry.findFirst({
    where: { organizationId: ctx.organizationId, sourceModule: module, sourceId },
    orderBy: { sourceVersion: "desc" },
    include: { lines: true },
  });
  if (!e || (await tx.journalEntry.count({ where: { reversesId: e.id } })) > 0) return null;
  return { id: e.id, journal: e.journal, day: dayOf(e.day), lines: e.lines.map((l) => ({ account: l.account, debit: l.debitCentimes, credit: l.creditCentimes, treasuryId: l.treasuryId })) };
}

/** FN8: when a source record's first entry was posted, null if never. */
export async function firstPostedAt(tx: Tx, ctx: TenantContext, module: string, sourceId: string): Promise<Date | null> {
  const e = await tx.journalEntry.findFirst({ where: { organizationId: ctx.organizationId, sourceModule: module, sourceId }, orderBy: { sourceVersion: "asc" }, select: { createdAt: true } });
  return e?.createdAt ?? null;
}

export async function sourceAlreadyPosted(tx: Tx, ctx: TenantContext, source: { module: string; id: string; version: number }) {
  const where = { organizationId: ctx.organizationId, sourceModule: source.module, sourceId: source.id, sourceVersion: source.version };
  return (await tx.journalEntry.count({ where })) > 0;
}

/** FN7: a source record's highest version posted, 0 when none: its next version is this + 1. */
export async function lastSourceVersion(tx: Tx, ctx: TenantContext, module: string, sourceId: string): Promise<number> {
  const r = await tx.journalEntry.aggregate({ where: { organizationId: ctx.organizationId, sourceModule: module, sourceId }, _max: { sourceVersion: true } });
  return r._max.sourceVersion ?? 0;
}

/** FCX6: the close of the fiscal year ending on `lastDay` (who, when), null while the year is open. */
export async function yearClose(tx: Tx, ctx: TenantContext, legalEntityId: string, lastDay: FarmDay) {
  return tx.fiscalYearClose.findFirst({ where: { organizationId: ctx.organizationId, legalEntityId, day: date(lastDay) } });
}
