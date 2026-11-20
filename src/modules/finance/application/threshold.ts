import { db } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { notify } from "@/modules/notifications";
import { listBudgets } from "@/modules/finance/application/budget";
import { budgetOf } from "@/modules/finance/domain/budget";
import { fiscalYearOf } from "@/modules/finance/domain/entry";
import { thresholdOn, thresholdUsage, type Threshold } from "@/modules/finance/domain/threshold";

export type ThresholdTracker = {
  threshold: Threshold;
  fiscalYear: { from: string; to: string };
  bookedCentimes: bigint;
  plannedCentimes: bigint;
  usage: ReturnType<typeof thresholdUsage>;
  history: { from: string; to: string; bookedCentimes: bigint; over: boolean }[]; // the last 3 fiscal years, newest first
};

/** Agricultural sales booked over [from, to]: the 712x lines (credit − debit) of the entity's ledger. */
async function bookedSales(ctx: TenantContext, legalEntityId: string, from: string, to: string): Promise<bigint> {
  const [row] = await db.$queryRaw<{ total: bigint | null }[]>`
    SELECT sum(l."creditCentimes" - l."debitCentimes")::bigint AS total
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE e."organizationId" = ${ctx.organizationId}::uuid AND e."legalEntityId" = ${legalEntityId}::uuid
      AND l.account LIKE '712%' AND e.day BETWEEN ${from}::date AND ${to}::date`;
  return row?.total ?? 0n;
}

/**
 * FN17: this fiscal year's agricultural sales booked plus those planned in the budgets saved during it, against the
 * threshold in force (configuration with a validity date, FQ5); the alert from 90 %; the last 3 years for the
 * "3 years in a row" rule. Owners and managers only.
 */
export async function thresholdTracker(ctx: TenantContext, clock: Clock = systemClock): Promise<Result<ThresholdTracker | null, "FORBIDDEN" | "NOT_FOUND">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN"); // a read: the accountant too (SPEC-m5 PA5)
  const [entity] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation in M1
  if (!entity) return fail("NOT_FOUND");
  const today = farmDayOf(clock.now());
  const threshold = thresholdOn(today);
  if (!threshold) return ok(null); // no threshold configured for today
  const year = fiscalYearOf(today, entity.fiscalYearStartMonth);

  const budgets = await listBudgets(ctx);
  const planned = budgets.ok
    ? budgets.value.filter((b) => b.createdAt.slice(0, 10) >= year.from && b.createdAt.slice(0, 10) <= year.to).reduce((s, b) => s + budgetOf(b.inputs).plannedSalesCentimes, 0n)
    : 0n;
  const booked = await bookedSales(ctx, entity.id, year.from, year.to);

  const history: ThresholdTracker["history"] = [];
  let before = year;
  for (let i = 0; i < 3; i++) {
    before = fiscalYearOf(addFarmDays(before.from as FarmDay, -1), entity.fiscalYearStartMonth);
    const sales = await bookedSales(ctx, entity.id, before.from, before.to);
    history.push({ from: before.from, to: before.to, bookedCentimes: sales, over: sales >= threshold.centimes });
  }
  return ok({ threshold, fiscalYear: year, bookedCentimes: booked, plannedCentimes: planned, usage: thresholdUsage(booked, planned, threshold.centimes), history });
}

/**
 * FN17: once this fiscal year's booked and planned sales reach 90 % of the threshold, the owners and managers get one
 * notification for that year (not urgent: quiet hours hold it). Called after each posting run; the ThresholdAlert row
 * claims the year, so a second run or a racing push sends nothing. Returns whether it notified.
 */
export async function alertThresholdOnce(ctx: TenantContext, clock: Clock = systemClock): Promise<boolean> {
  const tracker = await thresholdTracker(ctx, clock);
  if (!tracker.ok || !tracker.value?.usage.alert) return false;
  const { fiscalYear, usage } = tracker.value;
  const [entity] = await listLegalEntities(ctx);
  return db.$transaction(async (tx) => {
    const claim = { organizationId: ctx.organizationId, legalEntityId: entity.id, fiscalYearFrom: new Date(`${fiscalYear.from}T00:00:00Z`) };
    if ((await tx.thresholdAlert.createMany({ data: [claim], skipDuplicates: true })).count === 0) return false;
    await notify(tx, ctx, { roles: ["owner", "manager"], templateKey: "thresholdNear", params: { percent: String(usage.percent) }, urgency: "normal" }, clock);
    return true;
  });
}
