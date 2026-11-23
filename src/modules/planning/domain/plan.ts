import { addFarmDays, daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC-m5 PL1, PL2, PL5 and SPEC-m2-compliance BS5. Pure and isomorphic: the phone draws the planner and the placement
// warning from its local records, offline.

/** PL1: a batch planned in a house. The chick price is money (absent for workers). */
export type PlanDto = {
  id: string;
  farmId: string;
  houseId: string;
  placeOn: string; // farm day
  chicks: number;
  strainId: string;
  hatchery: string;
  chickPriceCentimes?: string | null;
  saleAge: number | null; // days; null: not decided
  status: "planned" | "cancelled" | "placed";
  batchId: string | null; // the batch it became (PL3)
};

/** PL5, §2: the owner's minimum downtime between two batches of a farm, from a source. Dated, never edited. */
export type DowntimeRule = { id: string; farmId: string; validFrom: string; minDays: number; source: string };

/**
 * CQ3, NQ4 (decided default, to review): "un vide sanitaire d'au moins vingt jours doit être pratiqué au niveau de
 * chaque ferme, entre deux bandes successives", table-egg farms house by house. Arrêté n° 2127-05 du 15 décembre 2005,
 * art. 4 (BO n° 5392 du 2 février 2006, p. 239). Built in, never seeded: in force for every farm without a higher rule.
 */
export const OFFICIAL_DOWNTIME = { minDays: 20, source: "Arrêté n° 2127-05 du 15 décembre 2005, art. 4" } as const;

/** PL5: the owner may set a higher figure, never a lower one. */
export const checkDowntimeRule = (r: { minDays: number }): Result<void, "DOWNTIME_BELOW_OFFICIAL"> =>
  r.minDays < OFFICIAL_DOWNTIME.minDays ? fail("DOWNTIME_BELOW_OFFICIAL") : ok(undefined);

export const saleDay = (placeOn: string, saleAge: number | null) => (saleAge === null ? null : addFarmDays(placeOn as FarmDay, saleAge));

/** A house's open batch or plan, by its placement day and its sale day when known. */
export type Slot = { kind: "batch" | "plan"; id: string; placeOn: string; saleDay: string | null };
export type HouseLine = Slot & { gapDays: number | null; overlaps: boolean; shortDowntime: boolean };

/**
 * PL2: a house's slots by placement day; for each, the days since the previous one's sale (negative: it is placed
 * before that sale), unknown when the previous sale day is.
 */
export function houseTimeline(slots: readonly Slot[], minDowntime: number): HouseLine[] {
  const ordered = [...slots].sort((a, b) => a.placeOn.localeCompare(b.placeOn) || a.id.localeCompare(b.id));
  return ordered.map((s, i) => {
    const before = ordered[i - 1]?.saleDay ?? null;
    const gapDays = before === null ? null : daysBetween(before as FarmDay, s.placeOn as FarmDay);
    return { ...s, gapDays, overlaps: gapDays !== null && gapDays < 0, shortDowntime: gapDays !== null && gapDays >= 0 && gapDays < minDowntime };
  });
}

/**
 * PL5: the farm's minimum downtime in force on a day: its latest rule with validFrom ≤ day, or the official one when it
 * has none (a rule below the official figure, entered before it was built in, gives way to it too).
 */
export function downtimeOn(rules: readonly DowntimeRule[], farmId: string, day: string): { minDays: number; source: string } {
  const inForce = rules.filter((r) => r.farmId === farmId && r.validFrom <= day).sort((a, b) => b.validFrom.localeCompare(a.validFrom) || b.id.localeCompare(a.id))[0];
  return inForce && inForce.minDays >= OFFICIAL_DOWNTIME.minDays ? inForce : OFFICIAL_DOWNTIME;
}

/** Art. 4: table-egg layers keep the downtime house by house; every other production type, farm-wide. */
export const downtimeByHouse = (species: string) => species === "layer";

/**
 * A house of the farm at a placement: `endedOn` is its last batch's end when that batch is closed (the clean-out's
 * disinfection day when known, else the batch's removal day), `openSince` the placement day of its open batch.
 */
export type HouseCycle = { houseId: string; endedOn: string | null; openSince: string | null };
type BatchEnd = { id: string; houseId: string; placedOn: string; status: string; closedOn?: string };

/**
 * The farm's houses from flock's batches and the clean-outs' disinfection days, keyed by the batch each follows; as
 * they stood on `asOf` when given (batches placed by then, closed only if closed by then).
 */
export function houseCycles(houseIds: readonly string[], batches: readonly BatchEnd[], disinfectedAfter: ReadonlyMap<string, string>, asOf?: string): HouseCycle[] {
  const then = asOf === undefined ? batches : batches.filter((b) => b.placedOn <= asOf).map((b) => ({ ...b, status: b.closedOn && b.closedOn <= asOf ? "closed" : "open" }));
  return houseIds.map((houseId) => {
    const own = then.filter((b) => b.houseId === houseId);
    const openSince = own.flatMap((b) => (b.status === "open" ? [b.placedOn] : [])).sort()[0] ?? null;
    const last = own.filter((b) => b.status === "closed").sort((a, b) => b.placedOn.localeCompare(a.placedOn))[0];
    return { houseId, openSince, endedOn: openSince !== null || !last ? null : (disinfectedAfter.get(last.id) ?? last.closedOn ?? null) };
  });
}

export type DowntimeWarning = { kind: "short"; elapsedDays: number; minDays: number } | { kind: "occupied"; houseId: string };

/**
 * CQ3 for a batch already placed (the inspection checklist, SPEC-m2-compliance RP4): the warning its placement
 * deserved, from the farm as it stood that day.
 */
export function batchDowntime(rules: readonly DowntimeRule[], batch: BatchEnd & { farmId: string; species: string }, farmBatches: readonly BatchEnd[], disinfectedAfter: ReadonlyMap<string, string>): DowntimeWarning | null {
  const others = farmBatches.filter((b) => b.id !== batch.id);
  const houses = [...new Set([batch.houseId, ...others.map((b) => b.houseId)])];
  const { minDays } = downtimeOn(rules, batch.farmId, batch.placedOn);
  return placementDowntime(minDays, downtimeByHouse(batch.species), houseCycles(houses, others, disinfectedAfter, batch.placedOn), batch.houseId, batch.placedOn);
}

/**
 * BS5, CQ3: placing a batch too soon gives a warning, never a block. Farm-wide, the downtime counts from the farm's
 * last end, and a house still holding a batch placed before that end is the previous cycle; house by house, from the
 * house's own end.
 */
export function placementDowntime(minDays: number, byHouse: boolean, houses: readonly HouseCycle[], houseId: string, placeOn: string): DowntimeWarning | null {
  const ends = houses.filter((h) => !byHouse || h.houseId === houseId).flatMap((h) => (h.endedOn !== null && h.endedOn <= placeOn ? [h.endedOn] : []));
  const lastEnd = ends.sort().at(-1);
  if (lastEnd === undefined) return null; // nothing ended yet: a first cycle
  const busy = byHouse ? undefined : houses.find((h) => h.houseId !== houseId && h.openSince !== null && h.openSince < lastEnd);
  if (busy) return { kind: "occupied", houseId: busy.houseId };
  const elapsedDays = daysBetween(lastEnd as FarmDay, placeOn as FarmDay);
  return elapsedDays < minDays ? { kind: "short", elapsedDays, minDays } : null;
}
