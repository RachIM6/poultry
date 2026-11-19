import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { Batch, type BatchStatus } from "@/modules/flock/domain/batch";
import type { BatchDto } from "@/modules/flock/schema";

// Batch repository (Prisma). Scoped to the caller's organisation.

const date = (day: string) => new Date(`${day}T00:00:00Z`); // a farm day, stored as a calendar date

/** B1: serializes placements in one house until the transaction ends, so the open-batch check can't race. */
export const lockHouse = (tx: Tx, houseId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${houseId}, 0))`;

export const findOpenInHouse = (tx: Tx, ctx: TenantContext, houseId: string) =>
  tx.batch.findFirst({ where: { organizationId: ctx.organizationId, houseId, status: "open" }, select: { id: true } });

export const batchIdTaken = async (tx: Tx, id: string) => (await tx.batch.count({ where: { id } })) > 0;

export async function saveNewBatch(tx: Tx, ctx: TenantContext, batch: Batch): Promise<Required<BatchDto>> {
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
