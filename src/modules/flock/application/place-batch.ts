import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { houseOf } from "@/modules/farm-registry";
import { Batch } from "@/modules/flock/domain/batch";
import { batchIdTaken, findOpenInHouse, lockHouse, saveNewBatch } from "@/modules/flock/infrastructure/batches";
import type { PlaceBatch } from "@/modules/flock/schema";
import { isStrain } from "@/modules/reference-data";

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
  if (!(await isStrain(tx, cmd.strainId))) return fail("INVALID_INPUT");

  // A phone's clock may run a little ahead of the server's: accept up to tomorrow's farm day.
  const today = nextFarmDay(farmDayOf(clock.now()));
  const batch = Batch.place(
    { ...cmd, farmId: house.farmId, placedOn: cmd.placedOn as FarmDay, chickUnitPriceCentimes: BigInt(cmd.chickUnitPriceCentimes) },
    today,
  );
  if (!batch.ok) return batch;

  await lockHouse(tx, house.id);
  if (await findOpenInHouse(tx, ctx, house.id)) return fail("HOUSE_HAS_OPEN_BATCH");
  if (await batchIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");

  const dto = await saveNewBatch(tx, ctx, batch.value);
  await recordChange(tx, ctx, "batch", dto.id, dto);
  await audit(tx, ctx, { entity: "Batch", entityId: dto.id, action: "create", after: dto, ...meta });
  return ok(undefined);
}
