import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { houseOf } from "@/modules/farm-registry";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { Batch, ageOfBatch, type BatchStatus } from "@/modules/flock/domain/batch";
import type { BatchDto, PaidOnDelivery } from "@/modules/flock/schema";
import type { BirdSex, ProductionType } from "@/modules/reference-data/shared";

// Batch repository (Prisma). Scoped to the caller's organisation.

const date = (day: string) => new Date(`${day}T00:00:00Z`); // a farm day, stored as a calendar date

/** B1: serializes placements in one house until the transaction ends, so the open-batch check can't race. */
export const lockHouse = (tx: Tx, houseId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${houseId}, 0))`;

/** SPEC-m3 B8: the house's open batches, with what the sharing rule needs, but `except` (one closing in the same step). */
export const openInHouse = async (tx: Tx, ctx: TenantContext, houseId: string, except?: string) =>
  (await tx.batch.findMany({ where: { organizationId: ctx.organizationId, houseId, status: "open", ...(except && { id: { not: except } }) }, select: { species: true, sex: true } })).map((b) => ({
    species: b.species as ProductionType,
    sex: b.sex as BirdSex,
  }));

export const batchIdTaken = async (tx: Tx, id: string) => (await tx.batch.count({ where: { id } })) > 0;

// SPEC-finance §9 "Chicks paid on delivery", as stored: both columns set, or neither.
const paidOf = (r: { paidOnDeliveryCentimes: bigint | null; paidOnDeliveryCashAccountId: string | null }): PaidOnDelivery | null =>
  r.paidOnDeliveryCentimes === null ? null : { cashAccountId: r.paidOnDeliveryCashAccountId!, amountCentimes: String(r.paidOnDeliveryCentimes) };

/**
 * `chickVatCentimes`: SPEC-finance FN9, the delivery's VAT; `paid`: what was paid at delivery (§9). Both kept for
 * finance: no flock rule reads them.
 */
export async function saveNewBatch(tx: Tx, ctx: TenantContext, batch: Batch, chickVatCentimes: bigint | null = null, paid: PaidOnDelivery | null = null): Promise<BatchDto> {
  const p = batch.placement;
  const paidColumns = { paidOnDeliveryCentimes: paid && BigInt(paid.amountCentimes), paidOnDeliveryCashAccountId: paid?.cashAccountId ?? null };
  await tx.batch.create({
    data: { ...p, chickVatCentimes, ...paidColumns, organizationId: ctx.organizationId, placedOn: date(p.placedOn), status: batch.status },
  });
  return dtoOf(batch, chickVatCentimes, paid);
}

/** B1: the open batch's placement as corrected (the fields a correction may change), with its VAT. */
export async function saveCorrection(tx: Tx, batch: Batch, chickVatCentimes: bigint | null): Promise<BatchDto> {
  const p = batch.placement;
  const { houseId, strainId, chicksPlaced, freeChicks, deadOnArrival, hatchery, deliveryNote, chickUnitPriceCentimes } = p;
  const data = { houseId, strainId, chicksPlaced, freeChicks, deadOnArrival, hatchery, deliveryNote, chickUnitPriceCentimes, chickVatCentimes, placedOn: date(p.placedOn) };
  const r = await tx.batch.update({ where: { id: p.id }, data });
  return dtoOf(batch, chickVatCentimes, paidOf(r)); // not corrected: finance posts the payment once (SPEC-finance §9)
}

/** The placement's VAT as stored (SPEC-finance FN9), null when none was typed. */
export const placementVat = async (tx: Tx, ctx: TenantContext, id: string) =>
  (await tx.batch.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { chickVatCentimes: true } }))?.chickVatCentimes ?? null;

/** B1: what bounds a correction: the batch's entries, weighings and birds sold, and the closings of a house's batches. */
export async function recordedFor(tx: Tx, ctx: TenantContext, batchId: string, houseId: string) {
  const where = { batchId, organizationId: ctx.organizationId };
  const day = (r: { day: Date }) => r.day.toISOString().slice(0, 10);
  const [entries, weighings, sold, closed] = await Promise.all([
    tx.dailyEntry.findMany({ where, select: { day: true, dead: true, culled: true } }),
    tx.weighing.findMany({ where, select: { day: true } }),
    tx.soldBirds.findMany({ where, select: { day: true, birds: true } }),
    tx.batch.findMany({ where: { organizationId: ctx.organizationId, houseId, status: "closed" }, select: { id: true, houseId: true, closedOn: true } }),
  ]);
  return {
    entries: entries.map((e) => ({ ...e, day: day(e) })),
    weighings: weighings.map((w) => ({ day: day(w) })),
    sold: sold.map((s) => ({ ...s, day: day(s) })),
    closed: closed.map((b) => ({ ...b, closedOn: b.closedOn?.toISOString().slice(0, 10) ?? null })),
  };
}

const dtoOf = (batch: Batch, chickVatCentimes: bigint | null, paidOnDelivery: PaidOnDelivery | null): BatchDto => {
  const p = batch.placement;
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
    chickVatCentimes: chickVatCentimes === null ? null : String(chickVatCentimes),
    paidOnDelivery,
  };
};

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
    closedOn: (r.closedOn?.toISOString().slice(0, 10) ?? null) as FarmDay | null,
  };
}

/** B6: what the closing needs: other costs, the farm weight of every bird sold and the placement's VAT (SPEC-finance FN9). */
export async function closingTotals(tx: Tx, ctx: TenantContext, batchId: string) {
  const where = { batchId, organizationId: ctx.organizationId };
  const [other, sold, placed] = await Promise.all([
    tx.batchCost.aggregate({ where, _sum: { amountCentimes: true } }),
    tx.soldBirds.aggregate({ where, _sum: { liveWeightGrams: true } }),
    tx.batch.findFirst({ where: { id: batchId, organizationId: ctx.organizationId }, select: { chickVatCentimes: true } }),
  ]);
  return { otherCentimes: other._sum.amountCentimes ?? 0n, soldGrams: sold._sum.liveWeightGrams ?? 0, chickVatCentimes: placed?.chickVatCentimes ?? 0n };
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
    chickVatCentimes: r.chickVatCentimes === null ? null : String(r.chickVatCentimes), // the closing's version keeps it (FN7)
    paidOnDelivery: paidOf(r),
    closedOn: c.closedOn,
    closeReason: c.closeReason,
    soldGrams: c.soldGrams,
    costCentimes: String(c.costCentimes),
    costPerKgCentimes: c.costPerKgCentimes === null ? null : String(c.costPerKgCentimes),
  };
}

/** B6 "Reopening": the batch's closing as stored (its locked figures), or null outside the caller's organisation. */
export async function closingOf(tx: Tx, ctx: TenantContext, id: string) {
  const r = await tx.batch.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { closedOn: true, closeReason: true, soldGrams: true, costCentimes: true, costPerKgCentimes: true } });
  return r && { ...r, closedOn: r.closedOn?.toISOString().slice(0, 10) ?? null };
}

/** B6 "Reopening": every batch of a house, what the reopening rule reads of them. */
export const batchesOfHouse = async (tx: Tx, ctx: TenantContext, houseId: string) =>
  (await tx.batch.findMany({ where: { organizationId: ctx.organizationId, houseId }, select: { id: true, houseId: true, species: true, sex: true, status: true, placedOn: true } })).map((b) => ({
    ...b,
    species: b.species as ProductionType,
    sex: b.sex as BirdSex,
    placedOn: b.placedOn.toISOString().slice(0, 10),
  }));

/** B6 "Reopening": open again, its closing's figures cleared (the audit keeps them; the next closing locks new ones). */
export async function saveReopening(tx: Tx, batch: Batch): Promise<BatchDto> {
  const cleared = { closedOn: null, closeReason: null, soldGrams: null, costCentimes: null, costPerKgCentimes: null };
  const r = await tx.batch.update({ where: { id: batch.placement.id }, data: { ...cleared, status: batch.status } });
  return dtoOf(batch, r.chickVatCentimes, paidOf(r));
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

/** For finance (SPEC-finance §9 "Chicks paid on delivery"): the batches placed between two farm days and paid at delivery. */
export async function paidOnDeliveryBetween(tx: Tx, ctx: TenantContext, from: string, to: string) {
  const rows = await tx.batch.findMany({
    where: { organizationId: ctx.organizationId, placedOn: { gte: date(from), lte: date(to) }, paidOnDeliveryCentimes: { not: null } },
    select: { id: true, placedOn: true, hatchery: true, paidOnDeliveryCentimes: true },
    orderBy: { placedOn: "asc" },
  });
  return rows.map((r) => ({ batchId: r.id, placedOn: r.placedOn.toISOString().slice(0, 10), hatchery: r.hatchery, amountCentimes: r.paidOnDeliveryCentimes! }));
}

/** For finance's export (SPEC-finance FN18): each batch's farm, house, placement day, type (FC6) and hatchery (§9 placement debts), by id. */
export async function batchPlaces(tx: Tx, ctx: TenantContext, ids: string[]) {
  const rows = await tx.batch.findMany({ where: { organizationId: ctx.organizationId, id: { in: ids } }, select: { id: true, farmId: true, houseId: true, placedOn: true, species: true, hatchery: true } });
  return new Map(rows.map((r) => [r.id, { farmId: r.farmId, houseId: r.houseId, placedOn: r.placedOn.toISOString().slice(0, 10) as FarmDay, species: r.species as ProductionType, hatchery: r.hatchery }]));
}
