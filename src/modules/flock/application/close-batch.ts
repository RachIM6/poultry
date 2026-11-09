import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import type { Batch } from "@/modules/flock/domain/batch";
import { batchCost } from "@/modules/flock/domain/closing";
import { batchCostIdTaken, closingTotals, loadBatch, saveBatchCost, saveClosing } from "@/modules/flock/infrastructure/batches";
import type { BatchCostDto, CloseBatch, RecordBatchCost } from "@/modules/flock/schema";
import { batchConsumptionCost } from "@/modules/inventory";

type Meta = { mutationId: string; deviceCreatedAt: Date };
const todayOf = (clock: Clock) => nextFarmDay(farmDayOf(clock.now())); // a phone's clock may run a little ahead

/**
 * SPEC B6, inside the caller's transaction and under the batch's lock: the Batch closes on `day`, and its figures are
 * locked on the batch: kg sold and cost per kg sold = (chicks + valued consumptions + other costs) ÷ kg sold. Its house
 * is free for a new batch. `reason` is null when the sale of its last birds closed it.
 */
export async function closeBatchOn(tx: Tx, ctx: TenantContext, batch: Batch, day: FarmDay, reason: string | null, meta: Meta, clock: Clock) {
  const closed = batch.close(day, todayOf(clock));
  if (!closed.ok) return closed;
  const p = batch.placement;
  const [consumedCentimes, { otherCentimes, soldGrams }] = await Promise.all([batchConsumptionCost(tx, ctx, p.id), closingTotals(tx, p.id)]);
  const cost = batchCost({ chicksCentimes: BigInt(p.chicksPlaced) * p.chickUnitPriceCentimes, consumedCentimes, otherCentimes, soldGrams });
  const dto = await saveClosing(tx, batch, { closedOn: day, closeReason: reason, soldGrams, costCentimes: cost.totalCentimes, costPerKgCentimes: cost.perKgCentimes });
  await recordChange(tx, ctx, "batch", dto.id, dto);
  await audit(tx, ctx, {
    entity: "Batch",
    entityId: dto.id,
    action: "close",
    before: { status: "open" },
    after: { status: "closed", closedOn: day, closeReason: reason, costPerKgCentimes: dto.costPerKgCentimes },
    ...meta,
  });
  return ok(undefined);
}

/** SPEC B6, applied by the sync push: closed by hand, with a reason, birds still on hand or not. */
export async function closeBatch(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof CloseBatch>, meta: Meta, clock: Clock = systemClock) {
  const batch = await loadBatch(tx, ctx, cmd.batchId);
  if (!batch) return fail("NOT_FOUND");
  return closeBatchOn(tx, ctx, batch, cmd.day as FarmDay, cmd.reason, meta, clock);
}

/** SPEC B6, applied by the sync push: another cost of the open batch, counted in its cost per kg when it closes. */
export async function recordBatchCost(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof RecordBatchCost>, meta: Meta, clock: Clock = systemClock) {
  const batch = await loadBatch(tx, ctx, cmd.batchId);
  if (!batch) return fail("NOT_FOUND");
  if (await batchCostIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  const checked = batch.checkCost(cmd.day as FarmDay, BigInt(cmd.amountCentimes), todayOf(clock));
  if (!checked.ok) return checked;
  const cost: Required<BatchCostDto> = cmd;
  await saveBatchCost(tx, ctx, cost);
  await recordChange(tx, ctx, "batchCost", cost.id, cost);
  await audit(tx, ctx, { entity: "BatchCost", entityId: cost.id, action: "create", after: cost, ...meta });
  return ok(undefined);
}
