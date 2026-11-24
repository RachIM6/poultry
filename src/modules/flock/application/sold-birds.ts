import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { latestRecordableDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { closeBatchOn } from "@/modules/flock/application/close-batch";
import { loadBatch } from "@/modules/flock/infrastructure/batches";
import { birdsOnHandBesides, deleteSoldBirds, findSoldBirds, saveSoldBirds } from "@/modules/flock/infrastructure/daily-entries";
import type { SoldBirdsDto } from "@/modules/flock/schema";

/**
 * SPEC B5, for sales, inside its transaction: birds leave the batch alive, which lowers birds on hand while the batch
 * stays open. Checked by the Batch against the birds on hand (after the dead, culled and sold), under the batch's lock, before
 * anything is written. The sale of the last birds closes the batch (B6). Returns the batch's farm.
 */
export async function recordBirdsSold(tx: Tx, ctx: TenantContext, s: SoldBirdsDto, meta: { mutationId: string; deviceCreatedAt: Date }, clock: Clock = systemClock) {
  const batch = await loadBatch(tx, ctx, s.batchId);
  if (!batch) return fail("NOT_FOUND");
  const today = latestRecordableDay(clock);
  const onHand = await birdsOnHandBesides(tx, ctx, batch);
  const checked = batch.checkBirdsSold(s.day as FarmDay, s.birds, onHand, today);
  if (!checked.ok) return checked;

  await saveSoldBirds(tx, ctx, s);
  await recordChange(tx, ctx, "soldBirds", s.id, s);
  if (s.birds === onHand) {
    const closed = await closeBatchOn(tx, ctx, batch, s.day as FarmDay, null, meta, clock);
    if (!closed.ok) throw new Error(closed.error); // can't happen: the same day just passed the same check
  }
  return ok({ farmId: batch.placement.farmId });
}

/**
 * For sales, inside its transaction: a cancelled sale's birds come back to the batch (SPEC-finance §9 "Cancelled
 * records"). Refused once the batch is closed: no reopening in v1. Checks before it writes; nothing to do without them.
 */
export async function removeBirdsSold(tx: Tx, ctx: TenantContext, saleId: string): Promise<Result<void, "BATCH_CLOSED">> {
  const sold = await findSoldBirds(tx, ctx, saleId);
  if (!sold) return ok(undefined);
  const batch = await loadBatch(tx, ctx, sold.batchId);
  if (batch?.status !== "open") return fail("BATCH_CLOSED");
  await deleteSoldBirds(tx, ctx, saleId);
  await recordChange(tx, ctx, "soldBirds", saleId, null);
  return ok(undefined);
}
