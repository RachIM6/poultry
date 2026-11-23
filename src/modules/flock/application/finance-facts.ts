import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { houseOf } from "@/modules/farm-registry";
import type { ProductionType } from "@/modules/reference-data/shared";

const day = (d: Date) => d.toISOString().slice(0, 10);

export type BatchMoneyFacts = {
  id: string;
  farmId: string;
  houseId: string;
  houseName: string;
  species: ProductionType; // SPEC-finance FC3: the count sheet shows the production type
  placedOn: string;
  closedOn: string | null;
  status: string;
  started: number; // chicks placed − dead on arrival
  chicksPlaced: number;
  chickUnitPriceCentimes: bigint;
  chicksCentimes: bigint; // every chick placed, dead on arrival included (as the B6 cost)
  otherCentimes: bigint; // M1 T24's "other costs" (B6)
  soldGrams: number; // farm weight of every bird sold
  sold: number; // birds sold (SPEC-finance FC4's split by head)
  lost: number; // dead and culled, from the daily entries (FN13's mortality)
  out: { day: string; birds: number }[]; // deaths, culls and sales, by day (for bird-days)
  soldOut: { day: string; birds: number }[]; // the sales alone, by day (SPEC-finance FC6: a laying flock's culls)
  fromBatchId: string | null; // SPEC-m3 B13: a layer batch transferred from this pullet batch (SPEC-finance FC6)
};

/**
 * For finance (SPEC-finance FN13, FN14): every batch of the organisation, with what its result and bird-days need.
 * `asOf` (FC4): as on that day, from the facts dated on or before it only; a batch closed after it is still open.
 */
export async function batchesForFinance(tx: Tx, ctx: TenantContext, asOf?: string): Promise<BatchMoneyFacts[]> {
  const org = { organizationId: ctx.organizationId };
  const dated = asOf ? { ...org, day: { lte: new Date(`${asOf}T00:00:00Z`) } } : org;
  const [batches, entries, sold, costs] = await Promise.all([
    tx.batch.findMany({ where: asOf ? { ...org, placedOn: { lte: new Date(`${asOf}T00:00:00Z`) } } : org, orderBy: { placedOn: "asc" } }),
    tx.dailyEntry.findMany({ where: dated, select: { batchId: true, day: true, dead: true, culled: true } }),
    tx.soldBirds.findMany({ where: dated, select: { batchId: true, day: true, birds: true, liveWeightGrams: true } }),
    tx.batchCost.groupBy({ by: ["batchId"], where: dated, _sum: { amountCentimes: true } }),
  ]);
  const other = new Map(costs.map((c) => [c.batchId, c._sum.amountCentimes ?? 0n]));
  const houses = new Map<string, string>();
  for (const id of new Set(batches.map((b) => b.houseId))) houses.set(id, (await houseOf(tx, ctx, id))?.name ?? "");
  return batches.map((b) => ({
    id: b.id,
    farmId: b.farmId,
    houseId: b.houseId,
    houseName: houses.get(b.houseId) ?? "",
    species: b.species as ProductionType,
    placedOn: day(b.placedOn),
    closedOn: b.closedOn && !(asOf && day(b.closedOn) > asOf) ? day(b.closedOn) : null,
    status: b.status,
    started: b.chicksPlaced + b.freeChicks - b.deadOnArrival, // SPEC-m3 B10
    chicksPlaced: b.chicksPlaced,
    chickUnitPriceCentimes: b.chickUnitPriceCentimes,
    chicksCentimes: BigInt(b.chicksPlaced) * b.chickUnitPriceCentimes,
    otherCentimes: other.get(b.id) ?? 0n,
    soldGrams: sold.filter((s) => s.batchId === b.id).reduce((s, x) => s + x.liveWeightGrams, 0),
    sold: sold.filter((s) => s.batchId === b.id).reduce((s, x) => s + x.birds, 0),
    lost: entries.filter((e) => e.batchId === b.id).reduce((s, e) => s + e.dead + e.culled, 0),
    out: [
      ...entries.filter((e) => e.batchId === b.id).map((e) => ({ day: day(e.day), birds: e.dead + e.culled })),
      ...sold.filter((s) => s.batchId === b.id).map((s) => ({ day: day(s.day), birds: s.birds })),
    ],
    soldOut: sold.filter((s) => s.batchId === b.id).map((s) => ({ day: day(s.day), birds: s.birds })),
    fromBatchId: b.fromBatchId,
  }));
}

/** For finance (SPEC-finance FC4, FQ20): each batch's last weighing on or before `day` (the latest recorded that day). */
export async function lastWeighings(tx: Tx, ctx: TenantContext, day: string): Promise<Map<string, { count: number; totalGrams: number }>> {
  const rows = await tx.weighing.findMany({
    where: { organizationId: ctx.organizationId, day: { lte: new Date(`${day}T00:00:00Z`) } },
    orderBy: [{ batchId: "asc" }, { day: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    distinct: ["batchId"],
    select: { batchId: true, count: true, totalGrams: true },
  });
  return new Map(rows.map((w) => [w.batchId, { count: w.count, totalGrams: w.totalGrams }]));
}
