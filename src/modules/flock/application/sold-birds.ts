import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { loadBatch } from "@/modules/flock/infrastructure/batches";
import { lockBatch, outOnOtherDays, saveSoldBirds } from "@/modules/flock/infrastructure/daily-entries";
import type { SoldBirdsDto } from "@/modules/flock/schema";

/**
 * SPEC B5, for sales, inside its transaction: birds leave the batch alive, which lowers birds on hand while the batch
 * stays open. Checked by the Batch against everything already out (dead, culled, sold), under the batch's lock, before
 * anything is written. Returns the batch's farm.
 */
export async function recordBirdsSold(tx: Tx, ctx: TenantContext, s: SoldBirdsDto, clock: Clock = systemClock) {
  const batch = await loadBatch(tx, ctx, s.batchId);
  if (!batch) return fail("NOT_FOUND");
  await lockBatch(tx, s.batchId);
  const today = nextFarmDay(farmDayOf(clock.now())); // a phone's clock may run a little ahead
  const checked = batch.checkBirdsSold(s.day as FarmDay, s.birds, await outOnOtherDays(tx, s.batchId), today);
  if (!checked.ok) return checked;

  await saveSoldBirds(tx, ctx, s);
  await recordChange(tx, ctx, "soldBirds", s.id, s);
  return ok({ farmId: batch.placement.farmId });
}
