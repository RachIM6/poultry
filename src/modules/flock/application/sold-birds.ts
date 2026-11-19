import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { closeBatchOn } from "@/modules/flock/application/close-batch";
import { loadBatch } from "@/modules/flock/infrastructure/batches";
import { outOnOtherDays, saveSoldBirds } from "@/modules/flock/infrastructure/daily-entries";
import type { SoldBirdsDto } from "@/modules/flock/schema";

/**
 * SPEC B5, for sales, inside its transaction: birds leave the batch alive, which lowers birds on hand while the batch
 * stays open. Checked by the Batch against everything already out (dead, culled, sold), under the batch's lock, before
 * anything is written. The sale of the last birds closes the batch (B6). Returns the batch's farm.
 */
export async function recordBirdsSold(tx: Tx, ctx: TenantContext, s: SoldBirdsDto, meta: { mutationId: string; deviceCreatedAt: Date }, clock: Clock = systemClock) {
  const batch = await loadBatch(tx, ctx, s.batchId);
  if (!batch) return fail("NOT_FOUND");
  const today = nextFarmDay(farmDayOf(clock.now())); // a phone's clock may run a little ahead
  const out = await outOnOtherDays(tx, s.batchId);
  const checked = batch.checkBirdsSold(s.day as FarmDay, s.birds, out, today);
  if (!checked.ok) return checked;

  await saveSoldBirds(tx, ctx, s);
  await recordChange(tx, ctx, "soldBirds", s.id, s);
  if (out + s.birds === batch.birdsStarted) {
    const closed = await closeBatchOn(tx, ctx, batch, s.day as FarmDay, null, meta, clock);
    if (!closed.ok) throw new Error(closed.error); // can't happen: the same day just passed the same check
  }
  return ok({ farmId: batch.placement.farmId });
}
