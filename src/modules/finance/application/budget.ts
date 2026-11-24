import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { batchesForFinance, batchFacts } from "@/modules/flock";
import { batchConsumption } from "@/modules/inventory";
import { batchResults } from "@/modules/finance/application/batch-results";
import type { BudgetInputs } from "@/modules/finance/domain/budget";

/** FN15: a closed batch as a budget's starting point: its figures as what-if inputs. */
export type BudgetBase = { batchId: string; label: string; inputs: BudgetInputs };

const perKg = (centimes: bigint, grams: bigint) => (grams > 0n ? (centimes * 2000n + grams) / (2n * grams) : 0n);

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
        const feed = (await batchConsumption(tx, ctx, r.id)).get("feed") ?? { quantity: 0n, centimes: 0n };
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
