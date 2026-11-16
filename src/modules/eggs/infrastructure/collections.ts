import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { EggCollectionDto } from "@/modules/eggs/schema";

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
