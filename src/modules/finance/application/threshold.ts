import { db } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { batchFacts } from "@/modules/flock";
import { notify } from "@/modules/notifications";
import { salesByBatch } from "@/modules/sales";
import { listBudgets, type SavedBudget } from "@/modules/finance/application/budget";
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
 * FN17, SPEC-finance §9 FQ32: what the budgets still plan to sell. A batch's latest budget counts what the batch hasn't
 * sold yet while it is open, nothing once it is closed (its sales are booked); a budget with no batch counts when saved
 * during the fiscal year.
 */
async function plannedSales(ctx: TenantContext, budgets: SavedBudget[], year: { from: string; to: string }): Promise<bigint> {
  const sales = (b: SavedBudget) => budgetOf(b.inputs).plannedSalesCentimes;
  const latest = new Map<string, SavedBudget>();
  for (const b of budgets) if (b.batchId && !latest.has(b.batchId)) latest.set(b.batchId, b); // newest first
  let total = budgets.filter((b) => !b.batchId && b.createdAt.slice(0, 10) >= year.from && b.createdAt.slice(0, 10) <= year.to).reduce((s, b) => s + sales(b), 0n);
  if (latest.size === 0) return total;
  const [sold, facts] = await Promise.all([salesByBatch(db, ctx), Promise.all([...latest.keys()].map((id) => batchFacts(db, ctx, id)))]);
  [...latest].forEach(([batchId, b], i) => {
    if (facts[i]?.status !== "open") return;
    const left = sales(b) - (sold.get(batchId) ?? 0n);
    if (left > 0n) total += left;
  });
  return total;
}

/**
 * FN17: this fiscal year's agricultural sales booked plus those the budgets still plan (`plannedSales`), against the
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

  const years = [fiscalYearOf(addFarmDays(year.from as FarmDay, -1), entity.fiscalYearStartMonth)]; // the last 3, newest first
  while (years.length < 3) years.push(fiscalYearOf(addFarmDays(years[years.length - 1].from as FarmDay, -1), entity.fiscalYearStartMonth));
  // Independent reads, all at once on the pool
  const [planned, booked, ...past] = await Promise.all([
    listBudgets(ctx).then((budgets) => (budgets.ok ? plannedSales(ctx, budgets.value, year) : 0n)),
    bookedSales(ctx, entity.id, year.from, year.to),
    ...years.map((y) => bookedSales(ctx, entity.id, y.from, y.to)),
  ]);
  const history = years.map((y, i) => ({ from: y.from, to: y.to, bookedCentimes: past[i], over: past[i] >= threshold.centimes }));
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
