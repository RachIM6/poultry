import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { batchesForFinance } from "@/modules/flock";
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
            otherCostCentimes: r.costCentimes - r.costs.chicks - feed.centimes,
            plannedGrams: grams,
            salePricePerKgCentimes: perKg(r.salesCentimes, grams),
          },
        });
      }
      return bases;
    }),
  );
}

const amount = z.string().regex(/^\d{1,15}$/).transform(BigInt);
export const SaveBudget = z.object({
  name: z.string().trim().min(1).max(80),
  basedOn: z.uuid().nullable(),
  chicks: amount,
  chickPriceCentimes: amount,
  feedGrams: amount,
  feedPricePerKgCentimes: amount,
  otherCostCentimes: amount,
  plannedGrams: amount,
  salePricePerKgCentimes: amount,
});

export type SavedBudget = { id: string; name: string; basedOn: string | null; inputs: BudgetInputs; createdAt: string };

/** FN15: saves a planned batch's budget (owner, manager), audited. */
export async function saveBudget(ctx: TenantContext, input: unknown): Promise<Result<string, "FORBIDDEN" | "INVALID_INPUT">> {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  const parsed = SaveBudget.safeParse(input);
  if (!parsed.success || parsed.data.chicks > 2_147_483_647n) return fail("INVALID_INPUT");
  const { chicks, ...rest } = parsed.data;
  const id = uuidv7();
  await db.$transaction(async (tx) => {
    await tx.budget.create({ data: { id, organizationId: ctx.organizationId, ...rest, chicks: Number(chicks), createdBy: ctx.userId } });
    await audit(tx, ctx, { entity: "Budget", entityId: id, action: "create", after: { name: rest.name, basedOn: rest.basedOn } }); // a web action, not a sync mutation: no mutation id
  });
  return ok(id);
}

export async function listBudgets(ctx: TenantContext): Promise<Result<SavedBudget[], "FORBIDDEN">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN");
  const rows = await db.budget.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" } });
  return ok(
    rows.map((b) => ({
      id: b.id,
      name: b.name,
      basedOn: b.basedOn,
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
