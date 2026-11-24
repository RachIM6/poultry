import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { houseOf } from "@/modules/farm-registry";
import { canJoinHouse } from "@/modules/flock/domain/batch";
import { correctPlacement as correct, houseFreeFrom, recordedOf } from "@/modules/flock/domain/correction";
import { loadBatch, lockHouse, openInHouse, placementVat, recordedFor, saveCorrection } from "@/modules/flock/infrastructure/batches";
import type { CorrectPlacement } from "@/modules/flock/schema";
import { strainServes } from "@/modules/reference-data";

/**
 * SPEC B1 "Correcting a placement", applied by the sync push: load → the changes merged into the placement and checked
 * as a new one, bounded by what the batch recorded → save + change log + audit (before / after). The change log
 * republishes the batch, so finance reposts its chick purchase (SPEC-finance FN7: a reversal and the new version); birds
 * on hand, mortality and the KPIs are computed from the batch, so they follow. The house stays in the batch's farm.
 */
export async function correctPlacement(
  tx: Tx,
  ctx: TenantContext,
  cmd: z.infer<typeof CorrectPlacement>,
  meta: { mutationId: string; deviceCreatedAt: Date },
  clock: Clock = systemClock,
) {
  const batch = await loadBatch(tx, ctx, cmd.batchId);
  if (!batch) return fail("NOT_FOUND");
  const was = batch.placement;
  const { chickVatCentimes, chickUnitPriceCentimes, placedOn, ...rest } = cmd.changes;
  if (rest.strainId !== undefined && !(await strainServes(tx, rest.strainId, was.species))) return fail("INVALID_INPUT"); // R5
  const houseId = rest.houseId ?? was.houseId;
  if (houseId !== was.houseId) {
    const house = await houseOf(tx, ctx, houseId);
    if (!house) return fail("NOT_FOUND");
    if (house.farmId !== was.farmId) return fail("INVALID_INPUT");
    await lockHouse(tx, houseId);
  }

  const r = await recordedFor(tx, ctx, was.id, houseId);
  const recorded = { ...recordedOf(r.entries, r.weighings, r.sold), houseFreeFrom: houseFreeFrom(was, houseId, r.closed) };
  const changes = {
    ...rest,
    ...(placedOn !== undefined && { placedOn: placedOn as FarmDay }),
    ...(chickUnitPriceCentimes !== undefined && { chickUnitPriceCentimes: BigInt(chickUnitPriceCentimes) }),
  };
  const today = nextFarmDay(farmDayOf(clock.now())); // as a placement: a phone's clock may run a little ahead
  const corrected = correct(batch, changes, recorded, today);
  if (!corrected.ok) return corrected;
  if (houseId !== was.houseId) {
    const joins = canJoinHouse(was.species, await openInHouse(tx, ctx, houseId), was.sex); // SPEC-m3 B8, B9
    if (!joins.ok) return joins;
  }

  const vatBefore = await placementVat(tx, ctx, was.id);
  const vat = chickVatCentimes === undefined ? vatBefore : chickVatCentimes === null ? null : BigInt(chickVatCentimes);
  const dto = await saveCorrection(tx, corrected.value, vat);
  await recordChange(tx, ctx, "batch", dto.id, dto);
  const before = { ...was, chickUnitPriceCentimes: String(was.chickUnitPriceCentimes), chickVatCentimes: vatBefore === null ? null : String(vatBefore) };
  const changed = Object.keys(cmd.changes) as (keyof typeof cmd.changes)[];
  await audit(tx, ctx, { entity: "Batch", entityId: dto.id, action: "update", before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: cmd.changes, ...meta });
  return ok(undefined);
}
