import { v7 as uuidv7 } from "uuid";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { legalEntityIn, saveAccountingChoices, type AccountingChoices } from "@/modules/farm-registry";
import { chartOf } from "@/modules/finance/domain/chart";
import { checkEntry, firstOpenMonth, fiscalYearOf, monthOf, openingLines, reversalOf, type EntryError } from "@/modules/finance/domain/entry";
import {
  balancesBetween,
  entriesBetween,
  entryExists,
  ledgerAccounts,
  loadEntry,
  lockedMonths,
  saveEntry,
  sourceAlreadyPosted,
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
    const key = { legalEntityId_month: { legalEntityId, month } };
    if (locked) {
      await tx.lockedPeriod.upsert({ where: key, create: { organizationId: ctx.organizationId, legalEntityId, month, lockedBy: ctx.userId }, update: {} });
    } else {
      await tx.lockedPeriod.deleteMany({ where: { organizationId: ctx.organizationId, legalEntityId, month } });
    }
    await audit(tx, ctx, "LockedPeriod", legalEntityId, locked ? "lock" : "unlock", { month });
    return ok(undefined);
  });
}

/**
 * FN3: opens the fiscal year holding `day` with the à-nouveaux entry (OD, its first day), carrying forward the
 * previous year's closing balances. Once per year (its source key); nothing is posted after an empty year.
 * The first year in Dawra is opened by hand from the accountant's last balance sheet (FQ11 for cash_book entities).
 */
export async function openFiscalYear(ctx: TenantContext, legalEntityId: string, day: FarmDay): Promise<Result<string | null, PostError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  return db.$transaction(async (tx) => {
    const entity = await legalEntityIn(tx, ctx, legalEntityId);
    if (!entity) return fail("NOT_FOUND");
    const year = fiscalYearOf(day, entity.fiscalYearStartMonth);
    const previous = fiscalYearOf(addFarmDays(year.from, -1), entity.fiscalYearStartMonth);
    const lines = openingLines(await balancesBetween(tx, ctx, legalEntityId, previous.from, previous.to));
    if (lines.length === 0) return ok(null);
    const id = uuidv7();
    const source = { module: "finance", id: legalEntityId, version: Number(year.from.slice(0, 4)) };
    const posted = await postEntry(tx, ctx, { id, legalEntityId, journal: "OD", day: year.from, label: "À-nouveaux", reversesId: null, lines, source });
    return posted.ok ? ok(id) : posted;
  });
}

/**
 * FN1 (from T27): the owner changes the books, the PCA overlay or the fiscal-year start only while the current fiscal
 * year has no entry (CGNC "permanence des méthodes"). Saved and audited by farm-registry.
 */
export async function changeAccountingChoices(
  ctx: TenantContext,
  legalEntityId: string,
  choices: AccountingChoices & { fiscalYearStartMonth: number },
  clock: Clock = systemClock,
): Promise<Result<void, "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "FISCAL_YEAR_HAS_ENTRIES">> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  if (!Number.isInteger(choices.fiscalYearStartMonth) || choices.fiscalYearStartMonth < 1 || choices.fiscalYearStartMonth > 12) return fail("INVALID_INPUT");
  return db.$transaction(async (tx) => {
    const entity = await legalEntityIn(tx, ctx, legalEntityId); // row-locked: no entry can land while we decide
    if (!entity) return fail("NOT_FOUND");
    const year = fiscalYearOf(farmDayOf(clock.now()), entity.fiscalYearStartMonth);
    if ((await entriesBetween(tx, ctx, legalEntityId, year.from, year.to)) > 0) return fail("FISCAL_YEAR_HAS_ENTRIES");
    await saveAccountingChoices(tx, ctx, legalEntityId, choices);
    return ok(undefined);
  });
}
