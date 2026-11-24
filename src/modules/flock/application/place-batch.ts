import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { houseOf } from "@/modules/farm-registry";
import { Batch, canJoinHouse } from "@/modules/flock/domain/batch";
import { checkPaidOnDelivery } from "@/modules/flock/domain/closing";
import { batchIdTaken, lockHouse, openInHouse, saveNewBatch } from "@/modules/flock/infrastructure/batches";
import type { PlaceBatch } from "@/modules/flock/schema";
import { strainServes } from "@/modules/reference-data";

/**
 * SPEC B1, applied by the sync push: load → Batch.place → one-open-batch check → save + change log + audit.
 * Two phones placing a batch in the same house offline: whichever syncs second is rejected, never a 500.
 */
export async function placeBatch(
  tx: Tx,
  ctx: TenantContext,
  cmd: z.infer<typeof PlaceBatch>,
  meta: { mutationId: string; deviceCreatedAt: Date },
  clock: Clock = systemClock,
) {
  const house = await houseOf(tx, ctx, cmd.houseId);
  if (!house) return fail("NOT_FOUND");
  if (!(await strainServes(tx, cmd.strainId, cmd.species))) return fail("INVALID_INPUT"); // R5

  // A phone's clock may run a little ahead of the server's: accept up to tomorrow's farm day.
  const today = nextFarmDay(farmDayOf(clock.now()));
  const { paidOnDelivery: paid, ...placement } = cmd; // not the batch's: kept for finance, below
  const batch = Batch.place(
    { ...placement, farmId: house.farmId, placedOn: cmd.placedOn as FarmDay, chickUnitPriceCentimes: BigInt(cmd.chickUnitPriceCentimes) },
    today,
  );
  if (!batch.ok) return batch;
  const vat = cmd.chickVatCentimes === null ? null : BigInt(cmd.chickVatCentimes);
  // SPEC-finance §9 "Chicks paid on delivery": money out of a cash box, finance.record's as on /treasury. Refused rather
  // than dropped, so no payment is lost. The cash box is finance's: finance checks it when it posts.
  if (paid) {
    if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
    const fits = checkPaidOnDelivery(BigInt(paid.amountCentimes), cmd.chicksPlaced, BigInt(cmd.chickUnitPriceCentimes), vat ?? 0n);
    if (!fits.ok) return fits;
  }

  await lockHouse(tx, house.id);
  const joins = canJoinHouse(cmd.species, await openInHouse(tx, ctx, house.id), cmd.sex); // SPEC-m3 B8, B9
  if (!joins.ok) return joins;
  if (await batchIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");

  const dto = await saveNewBatch(tx, ctx, batch.value, vat, paid);
  await recordChange(tx, ctx, "batch", dto.id, dto);
  await audit(tx, ctx, { entity: "Batch", entityId: dto.id, action: "create", after: dto, ...meta });
  return ok(undefined);
}
