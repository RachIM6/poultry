import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { legalEntityIn, listLegalEntities, type LegalEntityDto } from "@/modules/farm-registry";
import { closeDepreciation } from "@/modules/finance/application/assets";
import { postEntry, type PostError } from "@/modules/finance/application/ledger";
import { chartOf } from "@/modules/finance/domain/chart";
import { CLOSE_KINDS, closeAction, closeSource, type CloseAction, type CloseKind } from "@/modules/finance/domain/close";
import { countDay, countYearOf } from "@/modules/finance/domain/count";
import { fiscalYearOf, monthOf, reversalOf } from "@/modules/finance/domain/entry";
import { inChart, type Posting } from "@/modules/finance/domain/posting";
import { lastSourceVersion, ledgerAccounts, lockedMonths, standingEntryFor, type EntryRow } from "@/modules/finance/infrastructure/ledger";

// SPEC-finance FCX4 (T103): "Préparer la clôture". Computes each kind's year-end entry, shows it, then posts it.

type FiscalYear = { from: FarmDay; to: FarmDay };

/** Each kind's rule entry for the fiscal year, or null when it has nothing to post. T106, T108 and T109 add theirs. */
const KINDS: Record<CloseKind, (tx: Tx, ctx: TenantContext, entity: LegalEntityDto, year: FiscalYear) => Promise<Posting | null>> = {
  depreciation: (tx, ctx, entity, year) => closeDepreciation(tx, ctx, entity.id, year.from, entity.fiscalYearStartMonth),
};

/** The fiscal year that ends in calendar year `year`, as the count sheet's (T107). */
const fiscalYear = (year: number, startMonth: number) => fiscalYearOf(countDay(year, startMonth), startMonth);

/** Each kind's entry in the entity's chart (PCA off → FN2's CGNC accounts), its standing version and what FN7 does. */
async function plan(tx: Tx, ctx: TenantContext, entity: LegalEntityDto, year: number) {
  const all = await ledgerAccounts(tx);
  const chart = chartOf(all, entity.accountingProfile.base, entity.accountingProfile.overlays);
  const everything = chartOf(all, "cgnc", ["pca"]);
  const fy = fiscalYear(year, entity.fiscalYearStartMonth);
  const kinds = [];
  for (const kind of CLOSE_KINDS) {
    const source = closeSource(kind, entity.id, year);
    const rule = await KINDS[kind](tx, ctx, entity, fy);
    const posting = rule && inChart(rule, everything, chart);
    if (rule && !posting) throw new Error(`${source}: an account has no home in this chart`); // a rule bug: accounts.test.ts
    const standing = await standingEntryFor(tx, ctx, "finance", source);
    kinds.push({ kind, source, posting, standing, action: closeAction(standing, posting && { day: fy.to, lines: posting.lines }) });
  }
  return { chart, kinds };
}

const yearIn = (y: number) => Number.isInteger(y) && y >= 2000 && y <= 2100;

export type CloseEntryView = { kind: CloseKind; action: CloseAction; lines: { account: string; label: string; debit: bigint; credit: bigint }[] };
export type ClosePreview = { year: number; day: FarmDay; books: "cash_book" | "ledger"; locked: boolean; entries: CloseEntryView[] };

/**
 * FCX4: the year-end entries of a fiscal year (by the calendar year it ends in; the current one by default), as the
 * run would post them. The owner runs it; the manager and the accountant see it (FCX1); workers nothing (FX2).
 * A `cash_book` entity has none.
 */
export async function closePreview(ctx: TenantContext, year: number | null, clock: Clock = systemClock): Promise<Result<ClosePreview, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN");
  const [entity] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation in M1
  if (!entity) return fail("NOT_FOUND");
  const y = year ?? countYearOf(farmDayOf(clock.now()), entity.fiscalYearStartMonth);
  if (!yearIn(y)) return fail("INVALID_INPUT");
  const { to: day } = fiscalYear(y, entity.fiscalYearStartMonth);
  const books = entity.accountingProfile.books;
  if (books !== "ledger") return ok({ year: y, day, books, locked: false, entries: [] });
  const [locked, { chart, kinds }] = await Promise.all([lockedMonths(db, ctx, entity.id), plan(db, ctx, entity, y)]);
  const entries = kinds.map(({ kind, action, posting, standing }) => ({
    kind,
    action,
    // What the run posts, or for a reversal alone what it cancels.
    lines: (posting?.lines ?? standing?.lines ?? []).map((l) => ({ account: l.account, label: chart.get(l.account)?.label ?? "", debit: l.debit, credit: l.credit })),
  }));
  return ok({ year: y, day, books, locked: locked.has(monthOf(day)), entries });
}

const CloseRun = z.object({ year: z.number().int() });

/**
 * FCX4: posts each kind's entry, OD on the fiscal year's last day, source `close:<kind>:<entity>:<year>`. FN7: the
 * same figures post nothing; changed ones post a reversal of the standing version and a new version; figures now zero
 * post the reversal alone. Refused while the year's last month is locked (never moved to another period), for a
 * `cash_book` entity, and for a year not yet begun. Owner only. Returns the entries posted.
 */
export async function runClose(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<number, PostError | "INVALID_INPUT" | "CASH_BOOK_NO_CLOSE" | "DAY_IN_FUTURE">> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = CloseRun.safeParse(input);
  if (!parsed.success || !yearIn(parsed.data.year)) return fail("INVALID_INPUT");
  const { year } = parsed.data;
  const [first] = await listLegalEntities(ctx);
  if (!first) return fail("NOT_FOUND");
  return db.$transaction(async (tx) => {
    const entity = await legalEntityIn(tx, ctx, first.id); // row-locked: one run at a time, and no lock or count meanwhile
    if (!entity) return fail("NOT_FOUND");
    if (entity.accountingProfile.books !== "ledger") return fail("CASH_BOOK_NO_CLOSE"); // no balance sheet
    const { from, to } = fiscalYear(year, entity.fiscalYearStartMonth);
    if (from > farmDayOf(clock.now())) return fail("DAY_IN_FUTURE");
    if ((await lockedMonths(tx, ctx, entity.id)).has(monthOf(to))) return fail("PERIOD_LOCKED");
    let posted = 0;
    const post = async (e: EntryRow) => {
      const r = await postEntry(tx, ctx, e);
      if (!r.ok) throw new Error(`${e.source?.id ?? e.reversesId}: ${r.error}`); // the checks above passed: a rule bug
      posted++;
    };
    for (const k of (await plan(tx, ctx, entity, year)).kinds) {
      if (k.standing && (k.action === "repost" || k.action === "reverse")) {
        await post({ id: uuidv7(), legalEntityId: entity.id, journal: k.standing.journal, day: to, label: "Annulation", reversesId: k.standing.id, lines: reversalOf(k.standing.lines) });
      }
      if (k.posting && (k.action === "post" || k.action === "repost")) {
        const version = (await lastSourceVersion(tx, ctx, "finance", k.source)) + 1;
        await post({ id: uuidv7(), legalEntityId: entity.id, journal: k.posting.journal, day: to, label: k.posting.label, reversesId: null, lines: k.posting.lines, source: { module: "finance", id: k.source, version } });
      }
    }
    return ok(posted);
  });
}
