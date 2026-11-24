import { db } from "@/lib/db";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { consumptionsBetween, type Consumption } from "@/modules/sales";
import { cashBookOf, trialBalance } from "@/modules/finance/domain/books";
import { balanceSheet, incomeStatement } from "@/modules/finance/domain/statements";
import { chartOf, leafAccounts } from "@/modules/finance/domain/chart";
import { fiscalYearOf, type Line } from "@/modules/finance/domain/entry";
import { monthPeriod } from "@/modules/finance/domain/batch";
import { ledgerAccounts, lockedMonths, yearClose } from "@/modules/finance/infrastructure/ledger";
import { entryTags } from "@/modules/finance/application/tags";
import type { EntryTags } from "@/modules/finance/domain/export";
import { cashBookAccount } from "@/modules/finance/domain/contribution";
import { unpostedConsumption } from "@/modules/finance/domain/posting";
import type { TreasuryKind } from "@/modules/finance/domain/treasury";

// piece, receipt, reversed: a manual entry's (FCX3), from its ManualEntry row; reversed: cancelled already (FN5)
type Entry = { id: string; day: string; journal: string; label: string; reversesId: string | null; lines: Line[]; piece?: string | null; receipt?: string | null; reversed?: boolean };

export type Books = {
  books: "cash_book" | "ledger"; // FN16: what the entity's profile shows
  month: string;
  lockedMonths: string[]; // FN5: the entity's locked months, "YYYY-MM", in order
  fiscalYear: { from: string; to: string };
  labels: Record<string, string>; // account number → its label in the chart
  cashBook: ReturnType<typeof cashBookOf>;
  tags: EntryTags; // FN16, FN18: each entry's party, farm, house and batch, from the record it posts
  unposted: (Consumption & { reason: NonNullable<ReturnType<typeof unpostedConsumption>> })[]; // FC7: the month's home consumptions that post nothing, and why
  // `ledger` entities only:
  journals?: { journal: string; entries: Entry[] }[];
  generalLedger?: { account: string; lines: { day: string; journal: string; label: string; debit: bigint; credit: bigint; running: bigint }[] }[];
  trialBalance?: ReturnType<typeof trialBalance>; // from the fiscal year's first day to the month's last
  incomeStatement?: ReturnType<typeof incomeStatement>; // F-Statements: a draft CPC over the same period
  balanceSheet?: ReturnType<typeof balanceSheet>; // FC8: the draft bilan on the month's last day, its result the CPC's net
  closedOn?: FarmDay | null; // FCX6: the day the fiscal year was closed; until then the statements are a "Projet"
  // FCX3: the owner's manual entry form; a `cash_book` entity's offers 5141, 5161 and the owner's account only (FN3, FQ11)
  postingAccounts?: { number: string; label: string }[];
  treasuryAccounts?: { id: string; kind: TreasuryKind; name: string }[]; // FN3: what its 5141 / 5161 lines name, same form
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
  const accounts = await ledgerAccounts(db);
  const labels = Object.fromEntries(accounts.map((a) => [a.number, a.label]));
  const inMonth = await entriesBetween(ctx, entity.id, period.from, period.to);
  const chart = chartOf(accounts, entity.accountingProfile.base, entity.accountingProfile.overlays);
  const everything = chartOf(accounts, "cgnc", ["pca"]);
  const unposted = (await consumptionsBetween(db, ctx, period.from, period.to)).flatMap((c) => {
    const reason = unpostedConsumption({ type: "consumption", id: c.id, day: c.day as FarmDay, amount: c.amountCentimes, takenBy: c.takenBy, individual: entity.form === "individual" }, everything, chart);
    return reason ? [{ ...c, reason }] : [];
  });
  const locked = [...(await lockedMonths(db, ctx, entity.id))].sort();
  const ledger = entity.accountingProfile.books === "ledger";
  const books: Books = {
    books: entity.accountingProfile.books,
    month,
    lockedMonths: locked,
    fiscalYear: year,
    labels,
    cashBook: cashBookOf(inMonth),
    tags: await entryTags(ctx, month),
    unposted,
    ...(can(ctx, "finance.manage") && {
      postingAccounts: leafAccounts(chart)
        .filter((a) => ledger || cashBookAccount(a.number, entity.form === "individual"))
        .map((a) => ({ number: a.number, label: a.label }))
        .sort((a, b) => a.number.localeCompare(b.number)),
      treasuryAccounts: (await db.treasuryAccount.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, kind: true, name: true }, orderBy: { name: "asc" } })).map((a) => ({ ...a, kind: a.kind as TreasuryKind })),
    }),
  };
  if (!ledger) return ok(books);

  const manual = new Map((await db.manualEntry.findMany({ where: { organizationId: ctx.organizationId, id: { in: inMonth.map((e) => e.id) } } })).map((m) => [m.id, m]));
  const reversed = new Set((await db.journalEntry.findMany({ where: { organizationId: ctx.organizationId, reversesId: { in: [...manual.keys()] } }, select: { reversesId: true } })).map((r) => r.reversesId));
  const journals = new Map<string, Entry[]>();
  for (const e of inMonth) {
    const m = manual.get(e.id);
    journals.set(e.journal, [...(journals.get(e.journal) ?? []), m ? { ...e, piece: m.piece, receipt: m.receiptFileId, reversed: reversed.has(e.id) } : e]);
  }
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
  const balance = trialBalance(sinceYearStart.flatMap((e) => e.lines));
  const closed = await yearClose(db, ctx, entity.id, year.to);
  return ok({
    ...books,
    journals: [...journals].sort(([a], [b]) => a.localeCompare(b)).map(([journal, entries]) => ({ journal, entries })),
    generalLedger: [...byAccount].sort(([a], [b]) => a.localeCompare(b)).map(([account, lines]) => ({ account, lines })),
    trialBalance: balance,
    incomeStatement: incomeStatement(balance.rows),
    balanceSheet: balanceSheet(balance.rows),
    closedOn: closed && farmDayOf(closed.closedAt),
  });
}
