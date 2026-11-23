import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { legalEntityIn, listLegalEntities, placeNames, type LegalEntityDto } from "@/modules/farm-registry";
import { closeDepreciation } from "@/modules/finance/application/assets";
import { closePosted } from "@/modules/finance/application/count";
import { closeHens, hensAtClose, type HensAtClose } from "@/modules/finance/application/hens";
import { batchLinesAtClose, closeBatches, closeProvision, closeStock, eggLinesAtClose, stockLinesAtClose } from "@/modules/finance/application/stocks";
import { closeSubsidies } from "@/modules/finance/application/subsidies";
import { lockMonth, postOpening, postVersion, type PostError } from "@/modules/finance/application/ledger";
import { chartOf } from "@/modules/finance/domain/chart";
import type { HensMethod } from "@/modules/finance/domain/hens";
import { CLOSE_KINDS, closeAction, closeSource, openingSource, type CloseAction, type CloseKind } from "@/modules/finance/domain/close";
import { countDay, countYearOf } from "@/modules/finance/domain/count";
import type { BatchAtClose, EggsAtClose, StockAtClose } from "@/modules/finance/domain/stocks";
import { fiscalYearOf, monthOf, monthsBetween } from "@/modules/finance/domain/entry";
import { inChart, type Posting } from "@/modules/finance/domain/posting";
import { entriesBetween, ledgerAccounts, lockedMonths, standingEntryFor, yearClose } from "@/modules/finance/infrastructure/ledger";

// SPEC-finance FCX4 (T103): "Préparer la clôture". Computes each kind's year-end entry, shows it, then posts it.
// FCX5, FCX6 (T104): "Clôturer l'exercice" locks the year and posts the next year's opening; reopening unlocks its last month.

type FiscalYear = { from: FarmDay; to: FarmDay };

/** Each kind's rule entry for the fiscal year, or null when it has nothing to post. */
const KINDS: Record<CloseKind, (tx: Tx, ctx: TenantContext, entity: LegalEntityDto, year: FiscalYear) => Promise<Posting | null>> = {
  depreciation: (tx, ctx, entity, year) => closeDepreciation(tx, ctx, entity.id, year.from, entity.fiscalYearStartMonth),
  subsidy: (tx, ctx, entity, year) => closeSubsidies(tx, ctx, entity.id, year, entity.fiscalYearStartMonth),
  stock: (tx, ctx, entity, year) => closeStock(tx, ctx, entity, year.to),
  batch: (tx, ctx, entity, year) => closeBatches(tx, ctx, entity, year.to),
  hens: (tx, ctx, entity, year) => closeHens(tx, ctx, entity, year),
  provision: (tx, ctx, entity, year) => closeProvision(tx, ctx, entity, year.to),
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

/** What the run would still post: the year close waits for it (FCX6). */
const pending = (a: CloseAction) => a === "post" || a === "repost" || a === "reverse";

const yearIn = (y: number) => Number.isInteger(y) && y >= 2000 && y <= 2100;

export type CloseEntryView = { kind: CloseKind; action: CloseAction; lines: { account: string; label: string; debit: bigint; credit: bigint }[] };
/** FC5: a stock line as the run values it; `cost` null: not valued (nothing left, or no purchase cost). */
export type CloseStockView = StockAtClose & { farm: string };
/** FC4: a batch open on the last day as the run values it; `valued` false: a pullet or layer batch (FQ7). */
export type CloseBatchView = BatchAtClose & { farm: string };
/** FC5 (T113): a farm's eggs as the run values them; `posted` false: the PCA is off (FQ25). */
export type CloseEggsView = EggsAtClose & { farm: string };
/** FC6 (T114, T115): the layer and pullet batches by the entity's method; `method` null: not valued (FQ25). */
export type CloseHensView = { method: HensMethod | null; lines: (HensAtClose & { farm: string })[] };
/**
 * `frozen`: the run has posted, so the count and the current values no longer change (FCX4). `opening` (FN3, FCX6):
 * this year's à-nouveaux while the previous year isn't closed: "due" (not posted yet), "provisional" (posted from the
 * previous year as it stands, posted again by its close); null once that year is closed, before this one begins, or
 * when the previous year has no entry (the first year is opened by hand, FCX3).
 */
export type ClosePreview = {
  year: number;
  day: FarmDay;
  books: "cash_book" | "ledger";
  locked: boolean;
  closedOn: FarmDay | null;
  frozen: boolean;
  opening: "due" | "provisional" | null;
  entries: CloseEntryView[];
  stocks: CloseStockView[];
  batches: CloseBatchView[];
  eggs: CloseEggsView[];
  hens: CloseHensView;
};

/**
 * FCX4: the year-end entries of a fiscal year (by the calendar year it ends in; the current one by default), as the
 * run would post them, and whether the year is closed (FCX6: "Exercice clôturé le …"). The owner runs it; the manager
 * and the accountant see it (FCX1); workers nothing (FX2). A `cash_book` entity has none.
 */
export async function closePreview(ctx: TenantContext, year: number | null, clock: Clock = systemClock): Promise<Result<ClosePreview, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN");
  const [entity] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation in M1
  if (!entity) return fail("NOT_FOUND");
  const y = year ?? countYearOf(farmDayOf(clock.now()), entity.fiscalYearStartMonth);
  if (!yearIn(y)) return fail("INVALID_INPUT");
  const { from, to: day } = fiscalYear(y, entity.fiscalYearStartMonth);
  const previous = fiscalYear(y - 1, entity.fiscalYearStartMonth);
  const books = entity.accountingProfile.books;
  if (books !== "ledger") return ok({ year: y, day, books, locked: false, closedOn: null, frozen: false, opening: null, entries: [], stocks: [], batches: [], eggs: [], hens: { method: null, lines: [] } });
  const [locked, closed, frozen, previousClosed, previousEntries, opened, stock, batch, egg, hen, { chart, kinds }] = await Promise.all([
    lockedMonths(db, ctx, entity.id),
    yearClose(db, ctx, entity.id, day),
    closePosted(db, ctx, entity.id, y),
    yearClose(db, ctx, entity.id, previous.to),
    entriesBetween(db, ctx, entity.id, previous.from, previous.to),
    standingEntryFor(db, ctx, "finance", openingSource(entity.id, from)),
    stockLinesAtClose(db, ctx, entity, day),
    batchLinesAtClose(db, ctx, entity, day),
    eggLinesAtClose(db, ctx, entity, day),
    hensAtClose(db, ctx, entity, { from, to: day }),
    plan(db, ctx, entity, y),
  ]);
  const farms = await placeNames(db, ctx, [...new Set([...stock, ...batch, ...egg, ...hen.lines].map((l) => l.farmId))]);
  const stocks = stock.map((l) => ({ ...l, farm: farms.get(l.farmId) ?? "" }));
  const batches = batch.map((b) => ({ ...b, farm: farms.get(b.farmId) ?? "" }));
  const eggs = egg.map((e) => ({ ...e, farm: farms.get(e.farmId) ?? "" }));
  const hens = { method: hen.method, lines: hen.lines.map((h) => ({ ...h, farm: farms.get(h.farmId) ?? "" })) };
  const entries = kinds.map(({ kind, action, posting, standing }) => ({
    kind,
    action,
    // What the run posts, or for a reversal alone what it cancels.
    lines: (posting?.lines ?? standing?.lines ?? []).map((l) => ({ account: l.account, label: chart.get(l.account)?.label ?? "", debit: l.debit, credit: l.credit })),
  }));
  const opening = from > farmDayOf(clock.now()) || previousClosed || (previousEntries === 0 && !opened) ? null : opened ? "provisional" : "due";
  return ok({ year: y, day, books, locked: locked.has(monthOf(day)), closedOn: closed && farmDayOf(closed.closedAt), frozen, opening, entries, stocks, batches, eggs, hens });
}

const CloseRun = z.object({ year: z.number().int() });

/**
 * FCX4: posts each kind's entry, OD on the fiscal year's last day, source `close:<kind>:<entity>:<year>`. FN7: the
 * same figures post nothing; changed ones post a reversal of the standing version and a new version; figures now zero
 * post the reversal alone. Refused while the year's last month is locked (never moved to another period), for a
 * `cash_book` entity, for a year not yet begun, while a meat batch in progress has no current value (FC4: no
 * weighing or no sale to suggest one, and none typed), while a farm's eggs to post have no value per egg (FC5,
 * FQ18), and while a laying flock lacks the owner's figures (FC6: its life and cull value, or its current value per
 * bird under the simplified method). Owner only. Returns the entries posted.
 */
export async function runClose(
  ctx: TenantContext,
  input: unknown,
  clock: Clock = systemClock,
): Promise<Result<number, PostError | "INVALID_INPUT" | "CASH_BOOK_NO_CLOSE" | "DAY_IN_FUTURE" | "BATCH_VALUE_MISSING" | "EGG_VALUE_MISSING" | "HENS_VALUE_MISSING">> {
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
    if ((await batchLinesAtClose(tx, ctx, entity, to)).some((b) => b.missing)) return fail("BATCH_VALUE_MISSING");
    if ((await eggLinesAtClose(tx, ctx, entity, to)).some((e) => e.missing)) return fail("EGG_VALUE_MISSING");
    if ((await hensAtClose(tx, ctx, entity, { from, to })).lines.some((h) => h.missing)) return fail("HENS_VALUE_MISSING");
    let posted = 0;
    for (const k of (await plan(tx, ctx, entity, year)).kinds) posted += await postVersion(tx, ctx, entity.id, k.source, to, k.posting);
    return ok(posted);
  });
}

/**
 * FN3: "Ouvrir l'exercice", owner only, once the previous fiscal year has ended, without waiting for its close: posts
 * this year's à-nouveaux (OD, its first day) from the previous year's books as they stand, with the opening reversals
 * of the close entries already posted (FCX5), each in the entries' audit. Provisional until the previous year is
 * closed: the close posts it again (FCX6). Opening again with the same figures posts nothing; changed ones post a
 * reversal and a new version (FN7), never two live openings. Refused for a `cash_book` entity (no balance sheet:
 * FCX4, FQ11), before the year begins and while its first month is locked. Returns the entries posted.
 */
export async function openFiscalYear(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<number, PostError | "INVALID_INPUT" | "CASH_BOOK_NO_OPENING" | "YEAR_NOT_BEGUN">> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = CloseRun.safeParse(input);
  if (!parsed.success || !yearIn(parsed.data.year)) return fail("INVALID_INPUT");
  const [first] = await listLegalEntities(ctx);
  if (!first) return fail("NOT_FOUND");
  return db.$transaction(async (tx) => {
    const entity = await legalEntityIn(tx, ctx, first.id); // row-locked: one opening, run or close at a time
    if (!entity) return fail("NOT_FOUND");
    if (entity.accountingProfile.books !== "ledger") return fail("CASH_BOOK_NO_OPENING");
    const { from } = fiscalYear(parsed.data.year, entity.fiscalYearStartMonth);
    if (from > farmDayOf(clock.now())) return fail("YEAR_NOT_BEGUN");
    const opened = await postOpening(tx, ctx, entity, from);
    return opened.ok ? ok(opened.value.posted) : opened;
  });
}

const audit = (tx: Tx, ctx: TenantContext, action: string, legalEntityId: string, before: object | undefined, after: object) =>
  tx.auditEvent.create({ data: { organizationId: ctx.organizationId, userId: ctx.userId, entity: "FiscalYearClose", entityId: legalEntityId, action, before, after } });

export type YearCloseError = PostError | "INVALID_INPUT" | "CASH_BOOK_NO_CLOSE" | "YEAR_NOT_ENDED" | "PREVIOUS_YEAR_OPEN" | "CLOSE_RUN_PENDING";

/**
 * FCX6: "Clôturer l'exercice", after the close run and the accountant's approval (given outside the app, NQ7). In one
 * transaction: posts the next year's opening on its first day (the à-nouveaux and the reversals, FCX5, again by
 * reversal and new version when the closing changed), locks every month of the year (FN5, audited) and records who
 * closed it and when. Refused for a `cash_book` entity (no close run), for a year not over yet, while the previous
 * year has entries and isn't closed (its opening would be missing), while the close run still has something to post
 * ("run the close first"; eggs or hens without a value count, T113, FC6), and while the next year's first month is locked.
 * Closing a closed year again posts nothing. Owner only. Returns the opening entries posted.
 */
export async function closeFiscalYear(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<number, YearCloseError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = CloseRun.safeParse(input);
  if (!parsed.success || !yearIn(parsed.data.year)) return fail("INVALID_INPUT");
  const { year } = parsed.data;
  const [first] = await listLegalEntities(ctx);
  if (!first) return fail("NOT_FOUND");
  return db.$transaction(async (tx) => {
    const entity = await legalEntityIn(tx, ctx, first.id); // row-locked: no run, count or other close meanwhile
    if (!entity) return fail("NOT_FOUND");
    if (entity.accountingProfile.books !== "ledger") return fail("CASH_BOOK_NO_CLOSE");
    const { from, to } = fiscalYear(year, entity.fiscalYearStartMonth);
    if (to >= farmDayOf(clock.now())) return fail("YEAR_NOT_ENDED");
    const previous = fiscalYear(year - 1, entity.fiscalYearStartMonth);
    if ((await entriesBetween(tx, ctx, entity.id, previous.from, previous.to)) > 0 && !(await yearClose(tx, ctx, entity.id, previous.to))) return fail("PREVIOUS_YEAR_OPEN");
    if (
      (await plan(tx, ctx, entity, year)).kinds.some((k) => pending(k.action)) ||
      (await eggLinesAtClose(tx, ctx, entity, to)).some((e) => e.missing) ||
      (await hensAtClose(tx, ctx, entity, { from, to })).lines.some((h) => h.missing)
    )
      return fail("CLOSE_RUN_PENDING");
    const opened = await postOpening(tx, ctx, entity, addFarmDays(to, 1)); // first: refused before anything is written
    if (!opened.ok) return opened;
    const locked = await lockedMonths(tx, ctx, entity.id);
    for (const month of monthsBetween(from, to)) if (!locked.has(month)) await lockMonth(tx, ctx, entity.id, month, true);
    if (!(await yearClose(tx, ctx, entity.id, to))) {
      const closedAt = clock.now();
      await tx.fiscalYearClose.create({ data: { organizationId: ctx.organizationId, legalEntityId: entity.id, day: new Date(`${to}T00:00:00Z`), closedBy: ctx.userId, closedAt } });
      await audit(tx, ctx, "close", entity.id, undefined, { day: to, closedAt });
    }
    return ok(opened.value.posted);
  });
}

/**
 * FCX6: reopening a closed year, owner only, audited: unlocks its last month only, so the close run can post again,
 * and the year is no longer closed until the owner closes it again (which posts the opening again, FCX5). Refused while
 * the next year is closed: its opening could no longer follow.
 */
export async function reopenFiscalYear(ctx: TenantContext, input: unknown): Promise<Result<void, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "YEAR_NOT_CLOSED" | "NEXT_YEAR_CLOSED">> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = CloseRun.safeParse(input);
  if (!parsed.success || !yearIn(parsed.data.year)) return fail("INVALID_INPUT");
  const { year } = parsed.data;
  const [first] = await listLegalEntities(ctx);
  if (!first) return fail("NOT_FOUND");
  return db.$transaction(async (tx) => {
    const entity = await legalEntityIn(tx, ctx, first.id);
    if (!entity) return fail("NOT_FOUND");
    const { to } = fiscalYear(year, entity.fiscalYearStartMonth);
    const closed = await yearClose(tx, ctx, entity.id, to);
    if (!closed) return fail("YEAR_NOT_CLOSED");
    if (await yearClose(tx, ctx, entity.id, fiscalYear(year + 1, entity.fiscalYearStartMonth).to)) return fail("NEXT_YEAR_CLOSED");
    await tx.fiscalYearClose.delete({ where: { legalEntityId_day: { legalEntityId: entity.id, day: closed.day } } });
    await audit(tx, ctx, "reopen", entity.id, { day: to, closedBy: closed.closedBy, closedAt: closed.closedAt }, { day: to });
    await lockMonth(tx, ctx, entity.id, monthOf(to), false);
    return ok(undefined);
  });
}
