import { v7 as uuidv7 } from "uuid";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { z } from "zod";
import { BOOKS, booksAllowed, legalEntityIn, listLegalEntities, saveAccountingChoices, type LegalEntityDto } from "@/modules/farm-registry";
import { chartOf } from "@/modules/finance/domain/chart";
import { CLOSE_KINDS, REVERSED_AT_OPENING, closeAction, closeSource, openingReversalOf, openingSource, reversalSource } from "@/modules/finance/domain/close";
import { checkEntry, firstOpenMonth, fiscalYearOf, monthOf, openingLines, reversalOf, type EntryError } from "@/modules/finance/domain/entry";
import type { Posting } from "@/modules/finance/domain/posting";
import {
  balancesBetween,
  entriesBetween,
  entryExists,
  lastSourceVersion,
  ledgerAccounts,
  loadEntry,
  lockedMonths,
  saveEntry,
  sourceAlreadyPosted,
  standingEntryFor,
  type EntryRow,
} from "@/modules/finance/infrastructure/ledger";

export type PostError = EntryError | "FORBIDDEN" | "NOT_FOUND" | "PERIOD_LOCKED" | "ALREADY_EXISTS";

const audit = (tx: Tx, ctx: TenantContext, entity: string, entityId: string, action: string, after: object) =>
  tx.auditEvent.create({ data: { organizationId: ctx.organizationId, userId: ctx.userId, entity, entityId, action, after } });

const auditLines = (e: EntryRow) => ({
  journal: e.journal,
  day: e.day,
  label: e.label,
  reversesId: e.reversesId,
  lines: e.lines.map((l) => ({ account: l.account, debit: String(l.debit), credit: String(l.credit) })),
});

/**
 * SPEC-finance FN4–FN5: posts one balanced entry into a legal entity's books, in the caller's transaction (T30's
 * posting pipeline calls it with each farm event). The month must be open; the accounts must be in the entity's
 * chart (base + overlays). Audited. An entry already posted for the same `source` is a no-op (FN7).
 */
export async function postEntry(tx: Tx, ctx: TenantContext, e: EntryRow): Promise<Result<void, PostError>> {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  const entity = await legalEntityIn(tx, ctx, e.legalEntityId);
  if (!entity) return fail("NOT_FOUND");
  if (e.source && (await sourceAlreadyPosted(tx, e.source))) return ok(undefined);
  if ((await lockedMonths(tx, ctx, e.legalEntityId)).has(monthOf(e.day))) return fail("PERIOD_LOCKED");
  const { base, overlays } = entity.accountingProfile;
  const checked = checkEntry(e.lines, chartOf(await ledgerAccounts(tx), base, overlays));
  if (!checked.ok) return checked;
  if (await entryExists(tx, e.id)) return fail("ALREADY_EXISTS");
  await saveEntry(tx, ctx, e);
  await audit(tx, ctx, "JournalEntry", e.id, "create", auditLines(e));
  return ok(undefined);
}

/**
 * FN5: cancels a posted entry with the same lines, sides swapped, linked to it. Dated `day`, or the 1st of the first
 * open month after it when that month is locked. An entry is reversed at most once.
 */
export async function reverseEntry(ctx: TenantContext, entryId: string, day: FarmDay, label: string): Promise<Result<string, PostError | "ALREADY_REVERSED">> {
  return db.$transaction(async (tx) => {
    const original = await loadEntry(tx, ctx, entryId);
    if (!original) return fail("NOT_FOUND");
    if (original.reversed) return fail("ALREADY_REVERSED");
    const month = firstOpenMonth(monthOf(day), await lockedMonths(tx, ctx, original.legalEntityId));
    const id = uuidv7(); // created on the server, never offline
    const posted = await postEntry(tx, ctx, {
      id,
      legalEntityId: original.legalEntityId,
      journal: original.journal,
      day: month === monthOf(day) ? day : (`${month}-01` as FarmDay),
      label,
      reversesId: original.id,
      lines: reversalOf(original.lines),
    });
    return posted.ok ? ok(id) : posted;
  });
}

/** FN5: locking and unlocking a month of a legal entity's books, owner only, audited. */
export async function setPeriodLocked(ctx: TenantContext, legalEntityId: string, month: string, locked: boolean): Promise<Result<void, "FORBIDDEN" | "NOT_FOUND">> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail("NOT_FOUND");
  return db.$transaction(async (tx) => {
    if (!(await legalEntityIn(tx, ctx, legalEntityId))) return fail("NOT_FOUND");
    await lockMonth(tx, ctx, legalEntityId, month, locked);
    return ok(undefined);
  });
}

/** FN5 in the caller's transaction (the year close, FCX6, locks a whole year): one month locked or unlocked, audited. */
export async function lockMonth(tx: Tx, ctx: TenantContext, legalEntityId: string, month: string, locked: boolean) {
  const key = { legalEntityId_month: { legalEntityId, month } };
  if (locked) {
    await tx.lockedPeriod.upsert({ where: key, create: { organizationId: ctx.organizationId, legalEntityId, month, lockedBy: ctx.userId }, update: {} });
  } else {
    await tx.lockedPeriod.deleteMany({ where: { organizationId: ctx.organizationId, legalEntityId, month } });
  }
  await audit(tx, ctx, "LockedPeriod", legalEntityId, locked ? "lock" : "unlock", { month });
}

/**
 * FN7 for an entry finance computes itself (the close run, the opening), source `sourceId`, dated `day`: the same
 * figures post nothing; changed ones reverse the standing version on the same day and post the next version; none
 * now, the reversal alone. Throws on a refusal so the caller's transaction rolls back: the caller checks the period
 * first. Returns the entries posted.
 */
export async function postVersion(tx: Tx, ctx: TenantContext, legalEntityId: string, sourceId: string, day: FarmDay, posting: Posting | null): Promise<number> {
  const standing = await standingEntryFor(tx, ctx, "finance", sourceId);
  const action = closeAction(standing, posting && { day, lines: posting.lines });
  let posted = 0;
  const post = async (e: EntryRow) => {
    const r = await postEntry(tx, ctx, e);
    if (!r.ok) throw new Error(`${sourceId}: ${r.error}`); // the caller's checks passed: a rule bug
    posted++;
  };
  if (standing && (action === "repost" || action === "reverse")) {
    await post({ id: uuidv7(), legalEntityId, journal: standing.journal, day, label: "Annulation", reversesId: standing.id, lines: reversalOf(standing.lines) });
  }
  if (posting && (action === "post" || action === "repost")) {
    const version = (await lastSourceVersion(tx, ctx, "finance", sourceId)) + 1;
    await post({ id: uuidv7(), legalEntityId, journal: posting.journal, day, label: posting.label, reversesId: null, lines: posting.lines, source: { module: "finance", id: sourceId, version } });
  }
  return posted;
}

/**
 * FN3, FCX5: the entries opening the fiscal year that begins on `firstDay`, in the caller's transaction: the
 * à-nouveaux from the previous year's closing balances (classes 1–5 carried forward, the result on 1191 / 1199), then
 * the reversal of each reversible kind's standing close entry (`REVERSED_AT_OPENING`). Each is versioned (FN7): when
 * the closing changed, it is posted again by reversal and new version, so the opening always equals the closing.
 * Refused while the first month is locked. Returns the standing à-nouveaux and the entries posted.
 */
export async function postOpening(tx: Tx, ctx: TenantContext, entity: LegalEntityDto, firstDay: FarmDay): Promise<Result<{ id: string | null; posted: number }, "PERIOD_LOCKED">> {
  if ((await lockedMonths(tx, ctx, entity.id)).has(monthOf(firstDay))) return fail("PERIOD_LOCKED");
  const previous = fiscalYearOf(addFarmDays(firstDay, -1), entity.fiscalYearStartMonth);
  const closedYear = Number(previous.to.slice(0, 4)); // the close run's year (FCX4)
  const lines = openingLines(await balancesBetween(tx, ctx, entity.id, previous.from, previous.to));
  const source = openingSource(entity.id, firstDay);
  let posted = await postVersion(tx, ctx, entity.id, source, firstDay, lines.length > 0 ? { journal: "OD", label: "À-nouveaux", lines } : null);
  for (const kind of CLOSE_KINDS.filter((k) => REVERSED_AT_OPENING[k])) {
    const close = await standingEntryFor(tx, ctx, "finance", closeSource(kind, entity.id, closedYear));
    const reversal = close && { journal: "OD" as const, label: "Extourne des écritures de clôture", lines: openingReversalOf(close.lines) };
    posted += await postVersion(tx, ctx, entity.id, reversalSource(kind, entity.id, closedYear), firstDay, reversal);
  }
  return ok({ id: (await standingEntryFor(tx, ctx, "finance", source))?.id ?? null, posted });
}

/**
 * FN3: opens the fiscal year holding `day` with the à-nouveaux entry (OD, its first day), carrying forward the
 * previous year's closing balances, and the opening reversals (FCX5). Opening it again with the same balances posts
 * nothing; changed ones post a reversal and a new version (FN7); nothing is posted after an empty year. The year close
 * (FCX6) does the same. The first year in Dawra is opened by hand from the accountant's last balance sheet (FQ11 for
 * cash_book entities). Returns the standing à-nouveaux.
 */
export async function openFiscalYear(ctx: TenantContext, legalEntityId: string, day: FarmDay): Promise<Result<string | null, PostError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  return db.$transaction(async (tx) => {
    const entity = await legalEntityIn(tx, ctx, legalEntityId);
    if (!entity) return fail("NOT_FOUND");
    const opened = await postOpening(tx, ctx, entity, fiscalYearOf(day, entity.fiscalYearStartMonth).from);
    return opened.ok ? ok(opened.value.id) : opened;
  });
}

/** FN1, FN9: the owner's accounting choices; null keeps the legal form's default, an absent vatRegistered keeps it. */
const AccountingChoicesInput = z.object({
  books: z.enum(BOOKS).nullable(),
  pcaOverlay: z.boolean().nullable(),
  fiscalYearStartMonth: z.int32().min(1).max(12),
  vatRegistered: z.boolean().optional(),
});

/**
 * FN1 (from T27): the owner changes the books, the PCA overlay, the fiscal-year start or VAT registration (FN9) only
 * while the current fiscal year has no entry (CGNC "permanence des méthodes"). Saved and audited by farm-registry.
 */
export async function changeAccountingChoices(
  ctx: TenantContext,
  legalEntityId: string,
  input: unknown,
  clock: Clock = systemClock,
): Promise<Result<void, "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "FISCAL_YEAR_HAS_ENTRIES">> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = AccountingChoicesInput.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const choices = parsed.data;
  return db.$transaction(async (tx) => {
    const entity = await legalEntityIn(tx, ctx, legalEntityId); // row-locked: no entry can land while we decide
    if (!entity) return fail("NOT_FOUND");
    if (choices.books && !booksAllowed(entity.form).includes(choices.books)) return fail("INVALID_INPUT");
    if (await yearHasEntries(tx, ctx, entity, clock)) return fail("FISCAL_YEAR_HAS_ENTRIES");
    await saveAccountingChoices(tx, ctx, legalEntityId, choices);
    return ok(undefined);
  });
}

const yearHasEntries = async (tx: Tx, ctx: TenantContext, entity: { id: string; fiscalYearStartMonth: number }, clock: Clock) => {
  const year = fiscalYearOf(farmDayOf(clock.now()), entity.fiscalYearStartMonth);
  return (await entriesBetween(tx, ctx, entity.id, year.from, year.to)) > 0;
};

/** The profile screen: the entity, the books its form allows, and whether this fiscal year still lets them change. */
export async function accountingSettings(ctx: TenantContext, clock: Clock = systemClock) {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const [first] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation (see postPending)
  if (!first) return ok(null);
  return db.$transaction(async (tx) => {
    const entity = (await legalEntityIn(tx, ctx, first.id))!;
    return ok({ entity, books: booksAllowed(entity.form), locked: await yearHasEntries(tx, ctx, entity, clock) });
  });
}
