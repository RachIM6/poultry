import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { houseOf } from "@/modules/farm-registry";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { Batch, ageOfBatch, type BatchStatus } from "@/modules/flock/domain/batch";
import type { BatchCostDto, BatchDto } from "@/modules/flock/schema";
import type { BirdSex, ProductionType } from "@/modules/reference-data/shared";

// Batch repository (Prisma). Scoped to the caller's organisation.

const date = (day: string) => new Date(`${day}T00:00:00Z`); // a farm day, stored as a calendar date

/** B1: serializes placements in one house until the transaction ends, so the open-batch check can't race. */
export const lockHouse = (tx: Tx, houseId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${houseId}, 0))`;

/** SPEC-m3 B8: the house's open batches, with what the sharing rule needs. */
export const openInHouse = async (tx: Tx, ctx: TenantContext, houseId: string) =>
  (await tx.batch.findMany({ where: { organizationId: ctx.organizationId, houseId, status: "open" }, select: { species: true, sex: true } })).map((b) => ({
    species: b.species as ProductionType,
    sex: b.sex as BirdSex,
  }));

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
    species: p.species,
    strainId: p.strainId,
    placedOn: p.placedOn,
    chicksPlaced: p.chicksPlaced,
    deadOnArrival: p.deadOnArrival,
    hatchery: p.hatchery,
    deliveryNote: p.deliveryNote,
    dayOldWeightGrams: p.dayOldWeightGrams,
    ageAtPlacementDays: p.ageAtPlacementDays ?? 0,
    sex: p.sex ?? "mixed",
    freeChicks: p.freeChicks ?? 0,
    parentFlock: p.parentFlock ?? null,
    weakChicks: p.weakChicks ?? null,
    litterTempTenths: p.litterTempTenths ?? null,
    fromBatchId: p.fromBatchId ?? null,
    status: batch.status,
    chickUnitPriceCentimes: String(p.chickUnitPriceCentimes),
  };
}

/**
 * The Batch aggregate, or null outside the caller's organisation. Taken under the batch's lock until the transaction
 * ends, before it is read: every change to a batch (entries, weighings, sales, costs, closing) waits for the one before,
 * then sees its result, so nothing is added to a batch that has just closed and birds on hand can't race.
 */
export async function loadBatch(tx: Tx, ctx: TenantContext, id: string): Promise<Batch | null> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 1))`;
  const r = await tx.batch.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!r) return null;
  return Batch.rehydrate(
    {
      id: r.id,
      farmId: r.farmId,
      houseId: r.houseId,
      species: r.species as ProductionType,
      strainId: r.strainId,
      placedOn: r.placedOn.toISOString().slice(0, 10) as FarmDay,
      chicksPlaced: r.chicksPlaced,
      deadOnArrival: r.deadOnArrival,
      hatchery: r.hatchery,
      deliveryNote: r.deliveryNote,
      chickUnitPriceCentimes: r.chickUnitPriceCentimes,
      dayOldWeightGrams: r.dayOldWeightGrams,
      ageAtPlacementDays: r.ageAtPlacementDays,
      sex: r.sex as BirdSex,
      freeChicks: r.freeChicks,
      parentFlock: r.parentFlock,
      weakChicks: r.weakChicks,
      litterTempTenths: r.litterTempTenths,
      fromBatchId: r.fromBatchId,
    },
    r.status as BatchStatus,
  );
}

/** For other modules (health): what they need to know of a batch of the caller's organisation, or null. */
export async function batchFacts(tx: Tx, ctx: TenantContext, id: string) {
  const r = await tx.batch.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!r) return null;
  const house = await houseOf(tx, ctx, r.houseId);
  return {
    farmId: r.farmId,
    houseId: r.houseId,
    houseName: house?.name ?? "",
    placedOn: r.placedOn.toISOString().slice(0, 10) as FarmDay,
    ageAtPlacementDays: r.ageAtPlacementDays,
    species: r.species as ProductionType,
    status: r.status as BatchStatus,
  };
}

/** B6: what the closing needs: other costs and the farm weight of every bird sold. */
export async function closingTotals(tx: Tx, ctx: TenantContext, batchId: string) {
  const where = { batchId, organizationId: ctx.organizationId };
  const [other, sold] = await Promise.all([
    tx.batchCost.aggregate({ where, _sum: { amountCentimes: true } }),
    tx.soldBirds.aggregate({ where, _sum: { liveWeightGrams: true } }),
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
    species: r.species as ProductionType,
    strainId: r.strainId,
    placedOn: r.placedOn.toISOString().slice(0, 10),
    chicksPlaced: r.chicksPlaced,
    deadOnArrival: r.deadOnArrival,
    hatchery: r.hatchery,
    deliveryNote: r.deliveryNote,
    dayOldWeightGrams: r.dayOldWeightGrams,
    ageAtPlacementDays: r.ageAtPlacementDays,
    sex: r.sex as BirdSex,
    freeChicks: r.freeChicks,
    parentFlock: r.parentFlock,
    weakChicks: r.weakChicks,
    litterTempTenths: r.litterTempTenths,
    fromBatchId: r.fromBatchId,
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

/** For climate (CL3, CL4): the batch in this house on that farm day, its production type and the birds' age then, or null. */
export async function batchInHouseOn(tx: Tx, ctx: TenantContext, houseId: string, day: string) {
  const at = new Date(`${day}T00:00:00Z`);
  const r = await tx.batch.findFirst({
    where: { houseId, organizationId: ctx.organizationId, placedOn: { lte: at }, OR: [{ closedOn: null }, { closedOn: { gte: at } }] },
    orderBy: { placedOn: "desc" },
    select: { placedOn: true, species: true, ageAtPlacementDays: true },
  });
  return r && { productionType: r.species, age: ageOfBatch({ placedOn: r.placedOn.toISOString().slice(0, 10), ageAtPlacementDays: r.ageAtPlacementDays }, day as FarmDay) };
}

/** For finance's export (SPEC-finance FN18): each batch's farm, house, placement day and type (FC6), by id. */
export async function batchPlaces(tx: Tx, ctx: TenantContext, ids: string[]) {
  const rows = await tx.batch.findMany({ where: { organizationId: ctx.organizationId, id: { in: ids } }, select: { id: true, farmId: true, houseId: true, placedOn: true, species: true } });
  return new Map(rows.map((r) => [r.id, { farmId: r.farmId, houseId: r.houseId, placedOn: r.placedOn.toISOString().slice(0, 10) as FarmDay, species: r.species as ProductionType }]));
}
