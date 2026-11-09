import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { mergeDay } from "@/modules/flock/domain/daily-entry";
import { loadBatch } from "@/modules/flock/infrastructure/batches";
import { findEntry, lockBatch, outOnOtherDays, saveEntry } from "@/modules/flock/infrastructure/daily-entries";
import { dailyEntryId, type DailyEntryDto, type RecordDay } from "@/modules/flock/schema";
import { recordConsumption, removeConsumption } from "@/modules/inventory";

/**
 * SPEC B2 + S4, applied by the sync push. The day's entry is merged field by field with what the server already has
 * (two phones on the same day end as one entry, the overwritten values in the audit log), checked by the Batch, and its
 * feed becomes one consumption movement in inventory, in the same transaction.
 */
export async function recordDay(
  tx: Tx,
  ctx: TenantContext,
  cmd: z.infer<typeof RecordDay>,
  meta: { mutationId: string; deviceCreatedAt: Date },
  clock: Clock = systemClock,
) {
  const batch = await loadBatch(tx, ctx, cmd.batchId);
  if (!batch) return fail("NOT_FOUND");
  await lockBatch(tx, cmd.batchId);

  const id = dailyEntryId(cmd.batchId, cmd.day);
  const previous = await findEntry(tx, ctx, id);
  const merged = mergeDay(previous, cmd.changes);
  const today = nextFarmDay(farmDayOf(clock.now())); // a phone's clock may run a little ahead
  const checked = batch.checkDay(cmd.day as FarmDay, merged, await outOnOtherDays(tx, cmd.batchId, cmd.day), today);
  if (!checked.ok) return checked;

  if ("feed" in cmd.changes) {
    if (merged.feed) {
      const consumed = await recordConsumption(tx, ctx, { id, batchId: cmd.batchId, farmId: batch.placement.farmId, stockItemId: merged.feed.stockItemId, quantity: merged.feed.grams, day: cmd.day });
      if (!consumed.ok) return consumed; // nothing written yet
    } else if (previous?.feed) {
      await removeConsumption(tx, ctx, id);
    }
  }

  const entry = await saveEntry(tx, ctx, { id, batchId: cmd.batchId, day: cmd.day, ...merged } satisfies DailyEntryDto);
  await recordChange(tx, ctx, "dailyEntry", id, entry);
  const before = previous && Object.fromEntries(Object.keys(cmd.changes).map((k) => [k, previous[k as keyof typeof previous]]));
  await audit(tx, ctx, { entity: "DailyEntry", entityId: id, action: previous ? "update" : "create", before, after: cmd.changes, ...meta });
  return ok(undefined);
}
