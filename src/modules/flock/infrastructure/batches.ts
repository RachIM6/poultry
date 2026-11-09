import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { houseOf } from "@/modules/farm-registry";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { Batch, type BatchStatus } from "@/modules/flock/domain/batch";
import type { BatchCostDto, BatchDto } from "@/modules/flock/schema";

// Batch repository (Prisma). Scoped to the caller's organisation.

const date = (day: string) => new Date(`${day}T00:00:00Z`); // a farm day, stored as a calendar date

/** B1: serializes placements in one house until the transaction ends, so the open-batch check can't race. */
export const lockHouse = (tx: Tx, houseId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${houseId}, 0))`;

export const findOpenInHouse = (tx: Tx, ctx: TenantContext, houseId: string) =>
  tx.batch.findFirst({ where: { organizationId: ctx.organizationId, houseId, status: "open" }, select: { id: true } });

export const batchIdTaken = async (tx: Tx, id: string) => (await tx.batch.count({ where: { id } })) > 0;

export async function saveNewBatch(tx: Tx, ctx: TenantContext, batch: Batch): Promise<BatchDto> {
  const p = batch.placement;
  await tx.batch.create({
    data: { ...p, organizationId: ctx.organizationId, placedOn: date(p.placedOn), status: batch.status },
  });
  return {
    id: p.id,
    farmId: p.farmId,
    houseId: p.houseId,
    species: "broiler",
    strainId: p.strainId,
    placedOn: p.placedOn,
    chicksPlaced: p.chicksPlaced,
    deadOnArrival: p.deadOnArrival,
    hatchery: p.hatchery,
    deliveryNote: p.deliveryNote,
    dayOldWeightGrams: p.dayOldWeightGrams,
    status: batch.status,
    chickUnitPriceCentimes: String(p.chickUnitPriceCentimes),
  };
}

/** The Batch aggregate, or null outside the caller's organisation. */
export async function loadBatch(tx: Tx, ctx: TenantContext, id: string): Promise<Batch | null> {
  const r = await tx.batch.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!r) return null;
  return Batch.rehydrate(
    {
      id: r.id,
      farmId: r.farmId,
      houseId: r.houseId,
      strainId: r.strainId,
      placedOn: r.placedOn.toISOString().slice(0, 10) as FarmDay,
      chicksPlaced: r.chicksPlaced,
      deadOnArrival: r.deadOnArrival,
      hatchery: r.hatchery,
      deliveryNote: r.deliveryNote,
      chickUnitPriceCentimes: r.chickUnitPriceCentimes,
      dayOldWeightGrams: r.dayOldWeightGrams,
    },
    r.status as BatchStatus,
  );
}

/** For other modules (health): what they need to know of a batch of the caller's organisation, or null. */
export async function batchFacts(tx: Tx, ctx: TenantContext, id: string) {
  const r = await tx.batch.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!r) return null;
  const house = await houseOf(tx, ctx, r.houseId);
  return { farmId: r.farmId, houseName: house?.name ?? "", placedOn: r.placedOn.toISOString().slice(0, 10) as FarmDay, status: r.status as BatchStatus };
}

/** B6: what the closing needs: other costs and the farm weight of every bird sold. */
export async function closingTotals(tx: Tx, batchId: string) {
  const [other, sold] = await Promise.all([
    tx.batchCost.aggregate({ where: { batchId }, _sum: { amountCentimes: true } }),
    tx.soldBirds.aggregate({ where: { batchId }, _sum: { liveWeightGrams: true } }),
  ]);
  return { otherCentimes: other._sum.amountCentimes ?? 0n, soldGrams: sold._sum.liveWeightGrams ?? 0 };
}

/** B6: the batch closed, with its locked figures. Returns what pull sends (money stripped there for workers). */
export async function saveClosing(
  tx: Tx,
  batch: Batch,
  c: { closedOn: string; closeReason: string | null; soldGrams: number; costCentimes: bigint; costPerKgCentimes: bigint | null },
): Promise<Required<BatchDto>> {
  const r = await tx.batch.update({ where: { id: batch.placement.id }, data: { ...c, closedOn: date(c.closedOn), status: batch.status } });
  return {
    id: r.id,
    farmId: r.farmId,
    houseId: r.houseId,
    species: "broiler",
    strainId: r.strainId,
    placedOn: r.placedOn.toISOString().slice(0, 10),
    chicksPlaced: r.chicksPlaced,
    deadOnArrival: r.deadOnArrival,
    hatchery: r.hatchery,
    deliveryNote: r.deliveryNote,
    dayOldWeightGrams: r.dayOldWeightGrams,
    status: batch.status,
    chickUnitPriceCentimes: String(r.chickUnitPriceCentimes),
    closedOn: c.closedOn,
    closeReason: c.closeReason,
    soldGrams: c.soldGrams,
    costCentimes: String(c.costCentimes),
    costPerKgCentimes: c.costPerKgCentimes === null ? null : String(c.costPerKgCentimes),
  };
}

export const batchCostIdTaken = async (tx: Tx, id: string) => (await tx.batchCost.count({ where: { id } })) > 0;

export async function saveBatchCost(tx: Tx, ctx: TenantContext, c: Required<BatchCostDto>) {
  await tx.batchCost.create({ data: { ...c, organizationId: ctx.organizationId, day: date(c.day), amountCentimes: BigInt(c.amountCentimes) } });
}
