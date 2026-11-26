import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { divHalfUp } from "@/lib/kernel/money";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { batchesForFinance, batchFacts, type BatchMoneyFacts } from "@/modules/flock";
import { chicksCost } from "@/modules/flock/shared";
import { batchConsumptions, lastPurchaseTerms, type BatchConsumption } from "@/modules/inventory";
import { batchResults, type BatchResultRow } from "@/modules/finance/application/batch-results";
import type { BudgetInputs } from "@/modules/finance/domain/budget";
import type { CashTiming } from "@/modules/finance/domain/budget-cash";
import { medianDays, type PaymentDelays } from "@/modules/finance/domain/payment-delay";

/** FN15: a closed batch as a budget's starting point: its figures as what-if inputs, and when its money moved. */
// houseName and placedOn (YYYY-MM-DD): the screen writes the batch with its own date format.
export type BudgetBase = { batchId: string; houseName: string; placedOn: string; inputs: BudgetInputs; timing: CashTiming };

const perKg = (centimes: bigint, grams: bigint) => (grams > 0n ? divHalfUp(centimes * 1000n, grams) : 0n);

/**
 * FN15, §9 "Budget cash need": when a closed batch's money moved, by day since placement: the feed by its consumption
 * days, the other costs by the days of its other consumptions, of its expenses and of the placement's VAT, plus its
 * undated part (shared costs, M1 other costs) in equal shares each day; the sales by the kg sold each day.
 */
function timingOf(r: BatchResultRow, f: BatchMoneyFacts, consumed: BatchConsumption, expenses: { day: Date; amountCentimes: bigint }[]): CashTiming {
  const placed = f.placedOn as FarmDay;
  const at = (day: string) => daysBetween(placed, day as FarmDay);
  const lastDay = at(r.closedOn!);
  const days = BigInt(lastDay + 1); // the dated weights × days, so the undated part can go 1/days a day in whole numbers
  const dated: CashTiming["other"] = [
    [0, f.chickVatCentimes * days],
    ...[...consumed].filter(([kind]) => kind !== "feed").flatMap(([, k]) => [...k.byDay].map(([d, c]): [number, bigint] => [at(d), c * days])),
    ...expenses.map((e): [number, bigint] => [at(e.day.toISOString().slice(0, 10)), e.amountCentimes * days]),
  ];
  const undated = r.costs.other + r.costs.allocated;
  return {
    lastDay,
    feed: [...(consumed.get("feed")?.byDay ?? [])].map(([d, c]) => [at(d), c]),
    other: [...dated, ...Array.from({ length: lastDay + 1 }, (_, d): [number, bigint] => [d, undated])],
    sales: f.soldOut.map((s) => [at(s.day), BigInt(s.grams)]),
  };
}

/** FN15: every closed batch, newest first, turned into budget inputs (feed apart, so its price can be changed). */
export async function budgetBases(ctx: TenantContext): Promise<Result<BudgetBase[], "FORBIDDEN">> {
  const results = await batchResults(ctx);
  if (!results.ok) return results;
  const closed = results.value.filter((r) => r.closedOn !== null);
  if (closed.length === 0) return ok([]);
  // A read: each query on the pool, no interactive transaction holding a connection (P2028 under load).
  const ids = closed.map((r) => r.id);
  const [facts, consumptions, expenses] = await Promise.all([
    batchesForFinance(db, ctx).then((all) => new Map(all.map((b) => [b.id, b]))),
    batchConsumptions(db, ctx, ids),
    db.expense.findMany({ where: { organizationId: ctx.organizationId, batchId: { in: ids } }, select: { batchId: true, day: true, amountCentimes: true } }),
  ]);
  const bases: BudgetBase[] = [];
  for (const r of closed) {
    const f = facts.get(r.id)!;
    const consumed = consumptions.get(r.id)!;
    const feed = consumed.get("feed") ?? { quantity: 0n, centimes: 0n };
    const grams = BigInt(r.soldGrams);
    bases.push({
      batchId: r.id,
      houseName: r.houseName,
      placedOn: r.placedOn,
      inputs: {
        chicks: BigInt(f.chicksPlaced),
        chickPriceCentimes: f.chickUnitPriceCentimes,
        feedGrams: feed.quantity,
        feedPricePerKgCentimes: perKg(feed.centimes, feed.quantity),
        // the placement's VAT (FQ30) lands here; a pullet batch transferred to lay keeps its whole cost (FN13 hands it on)
        otherCostCentimes: r.costCentimes - r.costs.transferred - chicksCost(f.chicksPlaced, f.chickUnitPriceCentimes) - feed.centimes,
        plannedGrams: grams,
        salePricePerKgCentimes: perKg(r.salesCentimes, grams),
      },
      timing: timingOf(r, f, consumed, expenses.filter((e) => e.batchId === r.id)),
    });
  }
  return ok(bases);
}

const HISTORY = 10; // §9 "Budget cash need": the last purchases of an input its delay is the median of

/**
 * FN15, §9 "Budget cash need": the farm's own supplier delays, never a supplier's terms it didn't record. Feed: the
 * median days from purchase to the due day typed with it, over its last purchases (paid at once, or no due day: 0).
 * Chicks: from placement to the day its payments covered it (paid at delivery: 0), over its last placements paid off;
 * one still owed is left out. No history: 0, paid on the day.
 */
export async function budgetPaymentDelays(ctx: TenantContext): Promise<Result<PaymentDelays, "FORBIDDEN">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN");
  const [feed, batches, payments] = await Promise.all([
    lastPurchaseTerms(ctx, "feed", HISTORY),
    batchesForFinance(db, ctx),
    // §9 "Placement debts": source `placement:<batch>:pay:<payment>`, the delivery's `…:pay:delivery`
    db.journalEntry.findMany({ where: { organizationId: ctx.organizationId, sourceModule: "finance", sourceId: { startsWith: "placement:" } }, select: { day: true, sourceId: true, lines: { select: { debitCentimes: true } } } }),
  ]);
  const late = (from: string, to: string) => Math.max(0, daysBetween(from as FarmDay, to as FarmDay));
  const paidOf = Map.groupBy(payments, (e) => e.sourceId!.split(":")[1]);
  const placements = batches
    .filter((b) => b.fromBatchId === null && b.chicksCentimes > 0n) // a transferred layer batch bought nothing
    .flatMap((b) => {
      const paid = (paidOf.get(b.id) ?? [])
        // posted on a later open month when the placement's was locked: the delivery's payment is still day 0
        .map((e) => ({ day: e.sourceId!.endsWith(":delivery") ? b.placedOn : e.day.toISOString().slice(0, 10), amount: e.lines.reduce((s, l) => s + l.debitCentimes, 0n) }))
        .sort((x, y) => x.day.localeCompare(y.day));
      let run = 0n;
      const off = paid.find((p) => (run += p.amount) >= b.chicksCentimes);
      return off ? [{ placedOn: b.placedOn, days: late(b.placedOn, off.day) }] : [];
    })
    .sort((x, y) => y.placedOn.localeCompare(x.placedOn))
    .slice(0, HISTORY);
  return ok({ chicks: medianDays(placements.map((p) => p.days)), feed: medianDays(feed.map((p) => (p.dueOn ? late(p.day, p.dueOn) : 0))) });
}

/** FN17, SPEC-finance §9 FQ32: the open batches a budget can plan, for the form. */
export async function budgetBatches(ctx: TenantContext): Promise<Result<{ batchId: string; houseName: string; placedOn: string }[], "FORBIDDEN">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN");
  const open = (await batchesForFinance(db, ctx)).filter((b) => b.status === "open");
  return ok(open.map((b) => ({ batchId: b.id, houseName: b.houseName, placedOn: b.placedOn })));
}

const amount = z.string().regex(/^\d{1,15}$/).transform(BigInt);
const days = z.string().trim().regex(/^\d{1,3}$/).transform(Number).nullable().default(null); // 0–999
export const SaveBudget = z.object({
  id: z.uuid(), // SPEC §7: made by the form, so a double submit saves once
  name: z.string().trim().min(1).max(80),
  basedOn: z.uuid().nullable(),
  batchId: z.uuid().nullable().default(null), // FN17: the open batch it plans, if any (SPEC-finance §9 FQ32)
  chicks: amount,
  chickPriceCentimes: amount,
  feedGrams: amount,
  feedPricePerKgCentimes: amount,
  otherCostCentimes: amount,
  plannedGrams: amount,
  salePricePerKgCentimes: amount,
  saleDay: days, // §9 "Budget cash need": kept without a base only
  chickPaymentDays: days, // §9 "Budget cash need": the supplier delays typed; null: the farm's own when shown
  feedPaymentDays: days,
});

export type SavedBudget = {
  id: string;
  name: string;
  basedOn: string | null;
  batchId: string | null;
  saleDay: number | null;
  delays: { chicks: number | null; feed: number | null }; // §9 "Budget cash need": null, the farm's own when shown
  inputs: BudgetInputs;
  createdAt: string;
};

/**
 * FN15: saves a planned batch's budget (owner, manager), audited. `basedOn` must be a batch of the organisation,
 * `batchId` one of its open batches. The same id twice saves once (a double submit, a retry).
 */
export async function saveBudget(ctx: TenantContext, input: unknown): Promise<Result<string, "FORBIDDEN" | "INVALID_INPUT" | "ALREADY_EXISTS">> {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  const parsed = SaveBudget.safeParse(input);
  if (!parsed.success || parsed.data.chicks > 2_147_483_647n) return fail("INVALID_INPUT");
  const { id, chicks, saleDay, ...rest } = parsed.data;
  const retry = (prior: { organizationId: string } | null) => (prior?.organizationId === ctx.organizationId ? ok(id) : fail("ALREADY_EXISTS"));
  return db
    .$transaction(async (tx) => {
      const prior = await tx.budget.findUnique({ where: { id }, select: { organizationId: true } });
      if (prior) return retry(prior); // a retry
      if (rest.basedOn && !(await batchFacts(tx, ctx, rest.basedOn))) return fail("INVALID_INPUT");
      if (rest.batchId && (await batchFacts(tx, ctx, rest.batchId))?.status !== "open") return fail("INVALID_INPUT");
      const kept = rest.basedOn ? null : saleDay; // a copied budget takes its base batch's timing
      await tx.budget.create({ data: { id, organizationId: ctx.organizationId, ...rest, saleDay: kept, chicks: Number(chicks), createdBy: ctx.userId } });
      await audit(tx, ctx, { entity: "Budget", entityId: id, action: "create", after: { name: rest.name, basedOn: rest.basedOn, batchId: rest.batchId, saleDay: kept, chickPaymentDays: rest.chickPaymentDays, feedPaymentDays: rest.feedPaymentDays } }); // a web action, not a sync mutation: no mutation id
      return ok(id);
    })
    .catch(async (err) => {
      // Two submits at once: the second's insert hits the first's key once it commits.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      return retry(await db.budget.findUnique({ where: { id }, select: { organizationId: true } }));
    });
}

export async function listBudgets(ctx: TenantContext): Promise<Result<SavedBudget[], "FORBIDDEN">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN");
  const rows = await db.budget.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" } });
  return ok(
    rows.map((b) => ({
      id: b.id,
      name: b.name,
      basedOn: b.basedOn,
      batchId: b.batchId,
      saleDay: b.saleDay,
      delays: { chicks: b.chickPaymentDays, feed: b.feedPaymentDays },
      createdAt: b.createdAt.toISOString(),
      inputs: {
        chicks: BigInt(b.chicks),
        chickPriceCentimes: b.chickPriceCentimes,
        feedGrams: b.feedGrams,
        feedPricePerKgCentimes: b.feedPricePerKgCentimes,
        otherCostCentimes: b.otherCostCentimes,
        plannedGrams: b.plannedGrams,
        salePricePerKgCentimes: b.salePricePerKgCentimes,
      },
    })),
  );
}
