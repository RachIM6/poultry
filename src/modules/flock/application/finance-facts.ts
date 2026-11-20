import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { houseOf } from "@/modules/farm-registry";

const day = (d: Date) => d.toISOString().slice(0, 10);

export type BatchMoneyFacts = {
  id: string;
  farmId: string;
  houseId: string;
  houseName: string;
  placedOn: string;
  closedOn: string | null;
  status: string;
  started: number; // chicks placed − dead on arrival
  chicksPlaced: number;
  chickUnitPriceCentimes: bigint;
  chicksCentimes: bigint; // every chick placed, dead on arrival included (as the B6 cost)
  otherCentimes: bigint; // M1 T24's "other costs" (B6)
  soldGrams: number; // farm weight of every bird sold
  lost: number; // dead and culled, from the daily entries (FN13's mortality)
  out: { day: string; birds: number }[]; // deaths, culls and sales, by day (for bird-days)
};

/** For finance (SPEC-finance FN13, FN14): every batch of the organisation, with what its result and bird-days need. */
export async function batchesForFinance(tx: Tx, ctx: TenantContext): Promise<BatchMoneyFacts[]> {
  const org = { organizationId: ctx.organizationId };
  const [batches, entries, sold, costs] = await Promise.all([
    tx.batch.findMany({ where: org, orderBy: { placedOn: "asc" } }),
    tx.dailyEntry.findMany({ where: org, select: { batchId: true, day: true, dead: true, culled: true } }),
    tx.soldBirds.findMany({ where: org, select: { batchId: true, day: true, birds: true, liveWeightGrams: true } }),
    tx.batchCost.groupBy({ by: ["batchId"], where: org, _sum: { amountCentimes: true } }),
  ]);
  const other = new Map(costs.map((c) => [c.batchId, c._sum.amountCentimes ?? 0n]));
  const houses = new Map<string, string>();
  for (const id of new Set(batches.map((b) => b.houseId))) houses.set(id, (await houseOf(tx, ctx, id))?.name ?? "");
  return batches.map((b) => ({
    id: b.id,
    farmId: b.farmId,
    houseId: b.houseId,
    houseName: houses.get(b.houseId) ?? "",
    placedOn: day(b.placedOn),
    closedOn: b.closedOn ? day(b.closedOn) : null,
    status: b.status,
    started: b.chicksPlaced + b.freeChicks - b.deadOnArrival, // SPEC-m3 B10
    chicksPlaced: b.chicksPlaced,
    chickUnitPriceCentimes: b.chickUnitPriceCentimes,
    chicksCentimes: BigInt(b.chicksPlaced) * b.chickUnitPriceCentimes,
    otherCentimes: other.get(b.id) ?? 0n,
    soldGrams: sold.filter((s) => s.batchId === b.id).reduce((s, x) => s + x.liveWeightGrams, 0),
    lost: entries.filter((e) => e.batchId === b.id).reduce((s, e) => s + e.dead + e.culled, 0),
    out: [
      ...entries.filter((e) => e.batchId === b.id).map((e) => ({ day: day(e.day), birds: e.dead + e.culled })),
      ...sold.filter((s) => s.batchId === b.id).map((s) => ({ day: day(s.day), birds: s.birds })),
    ],
  }));
}
