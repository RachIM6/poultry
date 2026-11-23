import type { Tx } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { eggLots } from "@/modules/eggs/domain/stock";
import { eggFlowsOnDay } from "@/modules/eggs/infrastructure/collections";

/**
 * For finance (SPEC-finance FC3, FC5), read-only: each farm's eggs on hand at the end of `day` (E2's lots, from the
 * collections laid by then and the gradings, discards and draws recorded by then), farms with none left out.
 */
export async function eggStockOnDay(tx: Tx, ctx: TenantContext, day: FarmDay): Promise<{ farmId: string; eggs: number }[]> {
  const { farmOf, ...flows } = await eggFlowsOnDay(tx, ctx, day);
  const byFarm = new Map<string, number>();
  for (const l of eggLots(flows)) {
    const farmId = farmOf.get(l.batchId)!; // every lot comes from a row of its batch
    byFarm.set(farmId, (byFarm.get(farmId) ?? 0) + l.eggs);
  }
  return [...byFarm].filter(([, eggs]) => eggs > 0).map(([farmId, eggs]) => ({ farmId, eggs }));
}
