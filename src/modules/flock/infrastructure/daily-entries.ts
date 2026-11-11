import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { DayFields, DeathCause } from "@/modules/flock/domain/daily-entry";
import type { DailyEntryDto, SoldBirdsDto } from "@/modules/flock/schema";

// Daily entry repository (Prisma). Entries belong to the Batch aggregate; only flock's use cases call this.

const date = (day: string) => new Date(`${day}T00:00:00Z`);


type Row = {
  dead: number;
  deathCause: string | null;
  culled: number;
  feedStockItemId: string | null;
  feedGrams: number | null;
  waterMl: number | null;
  note: string | null;
};
const fields = (r: Row): DayFields => ({
  dead: r.dead,
  deathCause: r.deathCause as DeathCause | null,
  culled: r.culled,
  feed: r.feedStockItemId && r.feedGrams ? { stockItemId: r.feedStockItemId, grams: r.feedGrams } : null,
  waterMl: r.waterMl,
  note: r.note,
});

export async function findEntry(tx: Tx, ctx: TenantContext, id: string): Promise<DayFields | null> {
  const row = await tx.dailyEntry.findFirst({ where: { id, organizationId: ctx.organizationId } });
  return row && fields(row);
}

/** Dead + culled on the batch's other days (all days without `day`), plus every bird sold (B5). */
export async function outOnOtherDays(tx: Tx, batchId: string, day?: string): Promise<number> {
  const sum = await tx.dailyEntry.aggregate({ where: { batchId, ...(day && { NOT: { day: date(day) } }) }, _sum: { dead: true, culled: true } });
  const sold = await tx.soldBirds.aggregate({ where: { batchId }, _sum: { birds: true } });
  return (sum._sum.dead ?? 0) + (sum._sum.culled ?? 0) + (sold._sum.birds ?? 0);
}

/** B5: birds that left the batch alive, with the id of the sale that took them. */
export async function saveSoldBirds(tx: Tx, ctx: TenantContext, s: SoldBirdsDto) {
  await tx.soldBirds.create({ data: { ...s, organizationId: ctx.organizationId, day: date(s.day) } });
}

export async function saveEntry(tx: Tx, ctx: TenantContext, e: DailyEntryDto): Promise<DailyEntryDto> {
  const { feed, ...rest } = e;
  const data = { ...rest, day: date(e.day), feedStockItemId: feed?.stockItemId ?? null, feedGrams: feed?.grams ?? null };
  await tx.dailyEntry.upsert({ where: { id: e.id }, create: { ...data, organizationId: ctx.organizationId }, update: data });
  return e;
}
