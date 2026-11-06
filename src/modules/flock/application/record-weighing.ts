import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { loadBatch } from "@/modules/flock/infrastructure/batches";
import { saveWeighing, weighingIdTaken } from "@/modules/flock/infrastructure/weighings";
import type { RecordWeighing, WeighingDto } from "@/modules/flock/schema";

/** SPEC B3, applied by the sync push: a sample of the batch's birds on a day. The sample is kept as typed; the average
 * and CV are computed from it wherever they are shown. */
export async function recordWeighing(
  tx: Tx,
  ctx: TenantContext,
  cmd: z.infer<typeof RecordWeighing>,
  meta: { mutationId: string; deviceCreatedAt: Date },
  clock: Clock = systemClock,
) {
  const batch = await loadBatch(tx, ctx, cmd.batchId);
  if (!batch) return fail("NOT_FOUND");
  const today = nextFarmDay(farmDayOf(clock.now())); // a phone's clock may run a little ahead
  const checked = batch.checkWeighing(cmd.day as FarmDay, cmd.sample, today);
  if (!checked.ok) return checked;
  if (await weighingIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");

  const s = cmd.sample;
  const dto = await saveWeighing(tx, ctx, {
    id: cmd.id,
    batchId: cmd.batchId,
    day: cmd.day,
    ...("weightsGrams" in s
      ? { count: s.weightsGrams.length, totalGrams: s.weightsGrams.reduce((a, g) => a + g, 0), weightsGrams: s.weightsGrams }
      : { count: s.count, totalGrams: s.totalGrams, weightsGrams: [] }),
  } satisfies WeighingDto);
  await recordChange(tx, ctx, "weighing", dto.id, dto);
  await audit(tx, ctx, { entity: "Weighing", entityId: dto.id, action: "create", after: dto, ...meta });
  return ok(undefined);
}
