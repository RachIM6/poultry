import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { batchFacts } from "@/modules/flock";
import { checkDone } from "@/modules/health/domain/vaccination";
import { findVaccination, saveDone } from "@/modules/health/infrastructure/vaccinations";
import type { RecordVaccination } from "@/modules/health/schema";
import { recordConsumption } from "@/modules/inventory";

/**
 * SPEC H2 + S4, applied by the sync push: a line of the plan is done. The doses come out of the chosen vaccine lot as
 * one consumption movement with the line's id, in the same transaction; who did it is whoever recorded it.
 */
export async function recordVaccination(
  tx: Tx,
  ctx: TenantContext,
  cmd: z.infer<typeof RecordVaccination>,
  meta: { mutationId: string; deviceCreatedAt: Date },
  clock: Clock = systemClock,
) {
  const vaccination = await findVaccination(tx, ctx, cmd.id);
  const batch = vaccination && (await batchFacts(tx, ctx, vaccination.batchId));
  if (!vaccination || !batch) return fail("NOT_FOUND");
  const today = nextFarmDay(farmDayOf(clock.now())); // a phone's clock may run a little ahead
  const checked = checkDone(vaccination, batch, cmd.on as FarmDay, cmd.doses, today);
  if (!checked.ok) return checked;

  const consumed = await recordConsumption(tx, ctx, {
    id: vaccination.id,
    farmId: batch.farmId,
    stockItemId: cmd.stockItemId,
    quantity: cmd.doses,
    day: cmd.on,
    of: { kind: "vaccine", productId: vaccination.productId },
  });
  if (!consumed.ok) return consumed; // nothing written yet

  const done = { on: cmd.on, stockItemId: cmd.stockItemId, doses: cmd.doses, method: cmd.method, byUserId: ctx.userId };
  const dto = await saveDone(tx, vaccination.id, done);
  await recordChange(tx, ctx, "vaccination", dto.id, dto);
  await audit(tx, ctx, { entity: "Vaccination", entityId: dto.id, action: "done", after: done, ...meta });
  return ok(undefined);
}
