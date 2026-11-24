import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { batchesForFinance, batchFacts, type BatchMoneyFacts } from "@/modules/flock";
import { batchConsumption } from "@/modules/inventory";
import { batchResults, type BatchResultRow } from "@/modules/finance/application/batch-results";
import type { BudgetInputs } from "@/modules/finance/domain/budget";
import type { CashTiming } from "@/modules/finance/domain/budget-cash";

/** FN15: a closed batch as a budget's starting point: its figures as what-if inputs, and when its money moved. */
export type BudgetBase = { batchId: string; label: string; inputs: BudgetInputs; timing: CashTiming };

type Consumed = Awaited<ReturnType<typeof batchConsumption>>;

const perKg = (centimes: bigint, grams: bigint) => (grams > 0n ? (centimes * 2000n + grams) / (2n * grams) : 0n);

/**
 * FN15, §9 "Budget cash need": when a closed batch's money moved, by day since placement: the feed by its consumption
 * days, the other costs by the days of its other consumptions, of its expenses and of the placement's VAT, plus its
 * undated part (shared costs, M1 other costs) in equal shares each day; the sales by the kg sold each day.
 */
function timingOf(r: BatchResultRow, f: BatchMoneyFacts, consumed: Consumed, expenses: { day: Date; amountCentimes: bigint }[]): CashTiming {
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
  return ok(
    await db.$transaction(async (tx) => {
      const facts = new Map((await batchesForFinance(tx, ctx)).map((b) => [b.id, b]));
      const bases: BudgetBase[] = [];
      for (const r of closed) {
        const f = facts.get(r.id)!;
        const consumed = await batchConsumption(tx, ctx, r.id);
        const feed = consumed.get("feed") ?? { quantity: 0n, centimes: 0n };
        const expenses = await tx.expense.findMany({ where: { organizationId: ctx.organizationId, batchId: r.id }, select: { day: true, amountCentimes: true } });
        const grams = BigInt(r.soldGrams);
        bases.push({
          batchId: r.id,
          label: `${r.houseName} · ${r.placedOn}`,
          inputs: {
            chicks: BigInt(f.chicksPlaced),
            chickPriceCentimes: f.chickUnitPriceCentimes,
            feedGrams: feed.quantity,
            feedPricePerKgCentimes: perKg(feed.centimes, feed.quantity),
            otherCostCentimes: r.costCentimes - BigInt(f.chicksPlaced) * f.chickUnitPriceCentimes - feed.centimes, // the placement's VAT (FQ30) lands here
            plannedGrams: grams,
            salePricePerKgCentimes: perKg(r.salesCentimes, grams),
          },
          timing: timingOf(r, f, consumed, expenses),
        });
      }
      return bases;
    }),
  );
}

/** FN17, SPEC-finance §9 FQ32: the open batches a budget can plan, for the form. */
export async function budgetBatches(ctx: TenantContext): Promise<Result<{ batchId: string; label: string }[], "FORBIDDEN">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN");
  const open = (await batchesForFinance(db, ctx)).filter((b) => b.status === "open");
  return ok(open.map((b) => ({ batchId: b.id, label: `${b.houseName} · ${b.placedOn}` })));
}

const amount = z.string().regex(/^\d{1,15}$/).transform(BigInt);
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
});

export type SavedBudget = { id: string; name: string; basedOn: string | null; batchId: string | null; inputs: BudgetInputs; createdAt: string };

/**
 * FN15: saves a planned batch's budget (owner, manager), audited. `basedOn` must be a batch of the organisation,
 * `batchId` one of its open batches. The same id twice saves once (a double submit, a retry).
 */
export async function saveBudget(ctx: TenantContext, input: unknown): Promise<Result<string, "FORBIDDEN" | "INVALID_INPUT" | "ALREADY_EXISTS">> {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  const parsed = SaveBudget.safeParse(input);
  if (!parsed.success || parsed.data.chicks > 2_147_483_647n) return fail("INVALID_INPUT");
  const { id, chicks, ...rest } = parsed.data;
  const retry = (prior: { organizationId: string } | null) => (prior?.organizationId === ctx.organizationId ? ok(id) : fail("ALREADY_EXISTS"));
  return db
    .$transaction(async (tx) => {
      const prior = await tx.budget.findUnique({ where: { id }, select: { organizationId: true } });
      if (prior) return retry(prior); // a retry
      if (rest.basedOn && !(await batchFacts(tx, ctx, rest.basedOn))) return fail("INVALID_INPUT");
      if (rest.batchId && (await batchFacts(tx, ctx, rest.batchId))?.status !== "open") return fail("INVALID_INPUT");
      await tx.budget.create({ data: { id, organizationId: ctx.organizationId, ...rest, chicks: Number(chicks), createdBy: ctx.userId } });
      await audit(tx, ctx, { entity: "Budget", entityId: id, action: "create", after: { name: rest.name, basedOn: rest.basedOn, batchId: rest.batchId } }); // a web action, not a sync mutation: no mutation id
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
