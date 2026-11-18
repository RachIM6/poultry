import { db } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { cashBookOf, trialBalance } from "@/modules/finance/domain/books";
import { fiscalYearOf, type Line } from "@/modules/finance/domain/entry";
import { monthPeriod } from "@/modules/finance/domain/batch";
import { ledgerAccounts } from "@/modules/finance/infrastructure/ledger";

type Entry = { id: string; day: string; journal: string; label: string; reversesId: string | null; lines: Line[] };

export type Books = {
  books: "cash_book" | "ledger"; // FN16: what the entity's profile shows
  month: string;
  fiscalYear: { from: string; to: string };
  labels: Record<string, string>; // account number → its label in the chart
  cashBook: ReturnType<typeof cashBookOf>;
  // `ledger` entities only:
  journals?: { journal: string; entries: Entry[] }[];
  generalLedger?: { account: string; lines: { day: string; journal: string; label: string; debit: bigint; credit: bigint; running: bigint }[] }[];
  trialBalance?: ReturnType<typeof trialBalance>; // from the fiscal year's first day to the month's last
};

const date = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

async function entriesBetween(ctx: TenantContext, legalEntityId: string, from: string, to: string): Promise<Entry[]> {
  const rows = await db.journalEntry.findMany({
    where: { organizationId: ctx.organizationId, legalEntityId, day: { gte: date(from), lte: date(to) } },
    include: { lines: true },
    orderBy: [{ day: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((e) => ({
    id: e.id,
    day: dayOf(e.day),
    journal: e.journal,
    label: e.label,
    reversesId: e.reversesId,
    lines: e.lines.map((l) => ({ account: l.account, debit: l.debitCentimes, credit: l.creditCentimes, treasuryId: l.treasuryId })),
  }));
}

/**
 * FN16: the books of the organisation's legal entity for a month. A `cash_book` entity gets its receipts-and-expenses
 * book; a `ledger` entity also gets the journals, the general ledger and the trial balance (from its fiscal year's
 * first day, so the à-nouveaux entry is in it). Owners and managers only (FX2).
 */
export async function readBooks(ctx: TenantContext, month: string): Promise<Result<Books, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN"); // a read: the accountant too (SPEC-m5 PA5)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail("INVALID_INPUT");
  const [entity] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation in M1
  if (!entity) return fail("NOT_FOUND");
  const period = monthPeriod(month);
  const year = fiscalYearOf(period.from as FarmDay, entity.fiscalYearStartMonth);
  const labels = Object.fromEntries((await ledgerAccounts(db)).map((a) => [a.number, a.label]));
  const inMonth = await entriesBetween(ctx, entity.id, period.from, period.to);
  const books: Books = { books: entity.accountingProfile.books, month, fiscalYear: year, labels, cashBook: cashBookOf(inMonth) };
  if (entity.accountingProfile.books !== "ledger") return ok(books);

  const journals = new Map<string, Entry[]>();
  for (const e of inMonth) journals.set(e.journal, [...(journals.get(e.journal) ?? []), e]);
  const sinceYearStart = await entriesBetween(ctx, entity.id, year.from, period.to);
  const byAccount = new Map<string, NonNullable<Books["generalLedger"]>[number]["lines"]>();
  for (const e of sinceYearStart) {
    for (const l of e.lines) {
      const lines = byAccount.get(l.account) ?? [];
      const running = (lines.at(-1)?.running ?? 0n) + l.debit - l.credit;
      lines.push({ day: e.day, journal: e.journal, label: e.label, debit: l.debit, credit: l.credit, running });
      byAccount.set(l.account, lines);
    }
  }
  return ok({
    ...books,
    journals: [...journals].sort(([a], [b]) => a.localeCompare(b)).map(([journal, entries]) => ({ journal, entries })),
    generalLedger: [...byAccount].sort(([a], [b]) => a.localeCompare(b)).map(([account, lines]) => ({ account, lines })),
    trialBalance: trialBalance(sinceYearStart.flatMap((e) => e.lines)),
  });
}
