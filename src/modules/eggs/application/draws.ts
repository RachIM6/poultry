import type { Tx } from "@/lib/db";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { drawFifo, eggLots, type EggItem } from "@/modules/eggs/domain/stock";
import { eggFlowsOf, lockEggs, saveDraws } from "@/modules/eggs/infrastructure/collections";
import { drawId, type EggDrawDto } from "@/modules/eggs/schema";
import { batchFacts } from "@/modules/flock";

/**
 * SPEC-m3 V6, for sales, inside the sale's transaction: takes the eggs from a layer batch's lots, oldest first, under the
 * batch's egg lock. `day` = the sale's farm day: the eggs leave the stock on it. `withheld` = the laying days whose eggs may
 * not be sold (health's rule, passed by sales: eggs may not depend on health). Writes nothing when refused.
 */
export async function drawEggs(tx: Tx, ctx: TenantContext, d: { saleId: string; batchId: string; day: string; wanted: { item: EggItem; eggs: number }[]; withheld: { from: string; to: string }[] }) {
  const batch = await batchFacts(tx, ctx, d.batchId);
  if (!batch || batch.species !== "layer") return fail("NOT_FOUND");
  await lockEggs(tx, d.batchId);
  const drawn = drawFifo(eggLots(await eggFlowsOf(tx, ctx, d.batchId)), d.batchId, d.wanted, d.withheld);
  if (!drawn.ok) return drawn;
  const draws: EggDrawDto[] = drawn.value.map((x, n) => ({ id: drawId(d.saleId, n), batchId: d.batchId, saleId: d.saleId, day: d.day, ...x }));
  await saveDraws(tx, ctx, batch.farmId, draws);
  for (const x of draws) await recordChange(tx, ctx, "eggDraw", x.id, x);
  return ok(undefined);
}
