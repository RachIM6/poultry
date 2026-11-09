import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { batchFacts } from "@/modules/flock";
import { checkBatchDay, checkTreatment, withdrawalEnd, withdrawalUntil } from "@/modules/health/domain/withdrawal";
import { saveTreatment, saveVisit, treatmentIdTaken, treatmentsOf, visitIdTaken } from "@/modules/health/infrastructure/treatments";
import type { RecordTreatment, RecordVetVisit, TreatmentDto, VetVisitDto } from "@/modules/health/schema";
import { recordConsumption } from "@/modules/inventory";

type Meta = { mutationId: string; deviceCreatedAt: Date };
const todayOf = (clock: Clock) => nextFarmDay(farmDayOf(clock.now())); // a phone's clock may run a little ahead

/**
 * SPEC H3 + S4, applied by the sync push: a treatment of the batch, its withdrawal end computed by the domain rule, and
 * the medicine taken out of the chosen lot as one consumption movement with the treatment's id, in the same transaction.
 */
export async function recordTreatment(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof RecordTreatment>, meta: Meta, clock: Clock = systemClock) {
  const batch = await batchFacts(tx, ctx, cmd.batchId);
  if (!batch) return fail("NOT_FOUND");
  if (await treatmentIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  const t = { ...cmd, startOn: cmd.startOn as FarmDay, endOn: cmd.endOn as FarmDay };
  const checked = checkTreatment(batch, t, todayOf(clock));
  if (!checked.ok) return checked;

  const consumed = await recordConsumption(tx, ctx, {
    id: cmd.id,
    batchId: cmd.batchId,
    farmId: batch.farmId,
    stockItemId: cmd.stockItemId,
    quantity: cmd.quantity,
    day: cmd.startOn,
    of: { kind: "medicine" },
  });
  if (!consumed.ok) return consumed; // nothing written yet

  const dto: TreatmentDto = { ...cmd, withdrawalEndsOn: withdrawalEnd(t), byUserId: ctx.userId };
  await saveTreatment(tx, ctx, dto);
  await recordChange(tx, ctx, "treatment", dto.id, dto);
  await audit(tx, ctx, { entity: "Treatment", entityId: dto.id, action: "create", after: dto, ...meta });
  return ok(undefined);
}

/** V3, for sales: the last day of the batch's withdrawal running on `day`, or null. The same rule as the banner (H4). */
export const withdrawalOn = async (tx: Tx, ctx: TenantContext, batchId: string, day: FarmDay) => withdrawalUntil(await treatmentsOf(tx, ctx, batchId), day);

/** SPEC H5, applied by the sync push: a vet visit to the batch. */
export async function recordVetVisit(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof RecordVetVisit>, meta: Meta, clock: Clock = systemClock) {
  const batch = await batchFacts(tx, ctx, cmd.batchId);
  if (!batch) return fail("NOT_FOUND");
  if (await visitIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  const checked = checkBatchDay(batch, cmd.on as FarmDay, todayOf(clock));
  if (!checked.ok) return checked;

  const dto: VetVisitDto = { ...cmd, byUserId: ctx.userId };
  await saveVisit(tx, ctx, dto);
  await recordChange(tx, ctx, "vetVisit", dto.id, dto);
  await audit(tx, ctx, { entity: "VetVisit", entityId: dto.id, action: "create", after: dto, ...meta });
  return ok(undefined);
}
