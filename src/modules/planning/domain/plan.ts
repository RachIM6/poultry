import { addFarmDays, daysBetween, type FarmDay } from "@/lib/kernel/farm-day";

// SPEC-m5 PL1, PL2, PL5. Pure and isomorphic: the phone draws the planner from its local records, offline.

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

export const saleDay = (placeOn: string, saleAge: number | null) => (saleAge === null ? null : addFarmDays(placeOn as FarmDay, saleAge));

/** A house's open batch or plan, by its placement day and its sale day when known. */
export type Slot = { kind: "batch" | "plan"; id: string; placeOn: string; saleDay: string | null };
export type HouseLine = Slot & { gapDays: number | null; overlaps: boolean; shortDowntime: boolean };

/**
 * PL2: a house's slots by placement day; for each, the days since the previous one's sale (negative: it is placed
 * before that sale), unknown when the previous sale day is. The downtime warning needs the owner's minimum (§2).
 */
export function houseTimeline(slots: readonly Slot[], minDowntime: number | null): HouseLine[] {
  const ordered = [...slots].sort((a, b) => a.placeOn.localeCompare(b.placeOn) || a.id.localeCompare(b.id));
  return ordered.map((s, i) => {
    const before = ordered[i - 1]?.saleDay ?? null;
    const gapDays = before === null ? null : daysBetween(before as FarmDay, s.placeOn as FarmDay);
    return { ...s, gapDays, overlaps: gapDays !== null && gapDays < 0, shortDowntime: gapDays !== null && gapDays >= 0 && minDowntime !== null && gapDays < minDowntime };
  });
}

/** PL5: the farm's minimum downtime in force on a day (latest validFrom ≤ day), or null when none is entered. */
export function downtimeOn(rules: readonly DowntimeRule[], farmId: string, day: string): number | null {
  const inForce = rules.filter((r) => r.farmId === farmId && r.validFrom <= day).sort((a, b) => b.validFrom.localeCompare(a.validFrom) || b.id.localeCompare(a.id))[0];
  return inForce?.minDays ?? null;
}
