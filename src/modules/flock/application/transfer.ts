import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { latestRecordableDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { houseOf } from "@/modules/farm-registry";
import { closeBatchOn } from "@/modules/flock/application/close-batch";
import { Batch, canJoinHouse } from "@/modules/flock/domain/batch";
import { EMPTY_DAY, mergeDay } from "@/modules/flock/domain/daily-entry";
import { batchIdTaken, loadBatch, lockHouse, openInHouse, saveNewBatch } from "@/modules/flock/infrastructure/batches";
import { birdsOnHandBesides, findEntry, saveEntry } from "@/modules/flock/infrastructure/daily-entries";
import { TRANSFER_REASON, dailyEntryId, type TransferToLaying } from "@/modules/flock/schema";

type Meta = { mutationId: string; deviceCreatedAt: Date };

/**
 * SPEC-m3 B13, applied by the sync push, in one transaction: the pullets left behind are culled on the day, the pullet
 * batch closes (its costs stay with it), and a layer batch starts in the laying house, theirs or another, with the
 * birds' age. The hens cost nothing at this placement, so finance posts no chick purchase for it (a zero amount posts
 * nothing).
 */
export async function transferToLaying(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof TransferToLaying>, meta: Meta, clock: Clock = systemClock) {
  const pullets = await loadBatch(tx, ctx, cmd.batchId);
  const house = await houseOf(tx, ctx, cmd.houseId);
  if (!pullets || !house) return fail("NOT_FOUND");
  if (await batchIdTaken(tx, cmd.newBatchId)) return fail("ALREADY_EXISTS");
  const today = latestRecordableDay(clock);
  const day = cmd.day as FarmDay;

  const entryId = dailyEntryId(cmd.batchId, cmd.day);
  const previous = (await findEntry(tx, ctx, entryId)) ?? EMPTY_DAY;
  const onHand = await birdsOnHandBesides(tx, ctx, pullets); // every day, the transfer day's entry (`previous`) included
  const checked = pullets.checkTransfer(day, cmd.hens, onHand, today);
  if (!checked.ok) return checked;

  const p = pullets.placement;
  const hens = Batch.place(
    {
      id: cmd.newBatchId,
      farmId: house.farmId,
      houseId: house.id,
      species: "layer",
      strainId: p.strainId, // a pullet strain is a layer strain (R5)
      placedOn: day,
      chicksPlaced: cmd.hens,
      deadOnArrival: 0,
      hatchery: p.hatchery, // the origin stays traceable for the register
      deliveryNote: p.deliveryNote,
      chickUnitPriceCentimes: 0n,
      dayOldWeightGrams: null,
      ageAtPlacementDays: pullets.ageOn(day),
      fromBatchId: p.id,
    },
    today,
  );
  if (!hens.ok) return hens;
  await lockHouse(tx, house.id);
  const joins = canJoinHouse("layer", await openInHouse(tx, ctx, house.id, p.id)); // the pullets close below: their own house is free
  if (!joins.ok) return joins;

  const left = onHand - cmd.hens;
  if (left > 0) {
    const entry = { id: entryId, batchId: cmd.batchId, day: cmd.day, ...mergeDay(previous, { culled: previous.culled + left }) };
    await saveEntry(tx, ctx, entry);
    await recordChange(tx, ctx, "dailyEntry", entryId, entry);
    await audit(tx, ctx, { entity: "DailyEntry", entityId: entryId, action: "update", before: { culled: previous.culled }, after: { culled: entry.culled }, ...meta });
  }
  const closed = await closeBatchOn(tx, ctx, pullets, day, TRANSFER_REASON, meta, clock);
  if (!closed.ok) return closed;

  const dto = await saveNewBatch(tx, ctx, hens.value);
  await recordChange(tx, ctx, "batch", dto.id, dto);
  await audit(tx, ctx, { entity: "Batch", entityId: dto.id, action: "create", after: dto, ...meta });
  return ok(undefined);
}
