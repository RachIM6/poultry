import type { Tx } from "@/lib/db";
import { farmInstant, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import type { EggCollectionDto, EggDiscardDto, EggDrawDto, EggGradingDto, EggItem } from "@/modules/eggs/schema";

// Egg collection repository (Prisma), scoped to the caller's organisation.

const date = (day: string) => new Date(`${day}T00:00:00Z`);

type Row = {
  id: string;
  batchId: string;
  day: Date;
  normal: number;
  cracked: number;
  dirty: number;
  doubleYolk: number;
  floor: number;
  broken: number;
  sampleCount: number | null;
  sampleGrams: number | null;
};
const dto = (r: Row): EggCollectionDto => ({
  id: r.id,
  batchId: r.batchId,
  day: r.day.toISOString().slice(0, 10),
  counts: { normal: r.normal, cracked: r.cracked, dirty: r.dirty, doubleYolk: r.doubleYolk, floor: r.floor, broken: r.broken },
  sample: r.sampleCount && r.sampleGrams ? { count: r.sampleCount, grams: r.sampleGrams } : null,
});
const columns = (c: Pick<EggCollectionDto, "counts" | "sample">) => ({ ...c.counts, sampleCount: c.sample?.count ?? null, sampleGrams: c.sample?.grams ?? null });

/** Serializes every change to a batch's egg stock until the transaction ends, so two phones can't both take the last eggs. */
export const lockEggs = (tx: Tx, batchId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${batchId}, 2))`;

/** What a batch's egg stock is made of (E2): its collections, gradings, discards and draws. */
export const eggFlowsOf = (tx: Tx, ctx: TenantContext, batchId: string) => flowsWhere(tx, { organizationId: ctx.organizationId, batchId });

/**
 * The organisation's egg stock as at the end of `day`: the collections laid by then, and the gradings, discards and draws
 * recorded by then (they carry no day of their own: the farm day the server received them). `farmOf`: each batch's farm.
 */
export function eggFlowsOnDay(tx: Tx, ctx: TenantContext, day: FarmDay) {
  return flowsWhere(tx, { organizationId: ctx.organizationId }, { day: { lte: date(day) } }, { createdAt: { lt: farmInstant(nextFarmDay(day), 0) } });
}

async function flowsWhere(tx: Tx, where: { organizationId: string; batchId?: string }, laid: { day?: { lte: Date } } = {}, recorded: { createdAt?: { lt: Date } } = {}) {
  const [collections, gradings, discards, drawn] = await Promise.all([
    tx.eggCollection.findMany({ where: { ...where, ...laid } }),
    tx.eggGrading.findMany({ where: { ...where, ...recorded } }),
    tx.eggDiscard.findMany({ where: { ...where, ...recorded } }),
    tx.eggDraw.findMany({ where: { ...where, ...recorded } }),
  ]);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return {
    farmOf: new Map([...collections, ...gradings, ...discards, ...drawn].map((r) => [r.batchId, r.farmId])),
    collections: collections.map(dto),
    gradings: gradings.map((g) => ({ batchId: g.batchId, laidOn: day(g.laidOn), grades: g.grades as Record<string, number> })),
    discards: discards.map((d) => ({ batchId: d.batchId, laidOn: day(d.laidOn), item: d.item as EggItem, eggs: d.eggs })),
    drawn: drawn.map((d) => ({ batchId: d.batchId, laidOn: day(d.laidOn), item: d.item as EggItem, eggs: d.eggs })),
  };
}

export const gradingIdTaken = async (tx: Tx, id: string) => (await tx.eggGrading.count({ where: { id } })) > 0;
export const discardIdTaken = async (tx: Tx, id: string) => (await tx.eggDiscard.count({ where: { id } })) > 0;

export async function saveGrading(tx: Tx, ctx: TenantContext, farmId: string, g: EggGradingDto) {
  await tx.eggGrading.create({ data: { ...g, laidOn: date(g.laidOn), organizationId: ctx.organizationId, farmId, recordedBy: ctx.userId } });
}

export async function saveDiscard(tx: Tx, ctx: TenantContext, farmId: string, d: EggDiscardDto) {
  await tx.eggDiscard.create({ data: { ...d, laidOn: date(d.laidOn), organizationId: ctx.organizationId, farmId, recordedBy: ctx.userId } });
}

export const collectionIdTaken = async (tx: Tx, id: string) => (await tx.eggCollection.count({ where: { id } })) > 0;

export async function findCollection(tx: Tx, ctx: TenantContext, id: string) {
  const r = await tx.eggCollection.findFirst({ where: { id, organizationId: ctx.organizationId } });
  return r && { ...dto(r), farmId: r.farmId };
}

export async function saveNewCollection(tx: Tx, ctx: TenantContext, farmId: string, c: EggCollectionDto, recordedBy: string) {
  await tx.eggCollection.create({ data: { id: c.id, organizationId: ctx.organizationId, farmId, batchId: c.batchId, day: date(c.day), recordedBy, ...columns(c) } });
}

export async function saveCorrection(tx: Tx, c: EggCollectionDto) {
  await tx.eggCollection.update({ where: { id: c.id }, data: columns(c) });
}

export async function saveDraws(tx: Tx, ctx: TenantContext, farmId: string, draws: EggDrawDto[]) {
  await tx.eggDraw.createMany({ data: draws.map((d) => ({ ...d, laidOn: date(d.laidOn), organizationId: ctx.organizationId, farmId })) });
}
