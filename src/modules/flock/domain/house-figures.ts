import type { FarmDay } from "@/lib/kernel/farm-day";
import { curveFor, layingStandardAt, standardAt, type BirdSex, type ProductionType } from "@/modules/reference-data/shared";
import { ageOfBatch } from "@/modules/flock/domain/batch";
import { batchKpis } from "@/modules/flock/domain/kpi";
import { uniformityPercent, versusStandard } from "@/modules/flock/domain/weighing";

type KpiArgs = Parameters<typeof batchKpis>;
/** `weightsGrams` is empty for a group weighing (as WeighingDto). */
type Weighed = KpiArgs[2][number] & { weightsGrams: number[] };
type Aged = { placedOn: string; ageAtPlacementDays?: number };

const latest = <W extends KpiArgs[2][number]>(ws: readonly W[]) => [...ws].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id)).at(-1); // as batchKpis

/**
 * SPEC-m3 D1 (P-Owner), B9: a batch's figure on the owner's home and on the turkey pair. Broilers and turkeys: the
 * cumulative FCR at the latest weighing (B4's batchKpis). Pullets: the latest weighing's uniformity (B12). Null for the
 * other types, before a weighing, or when the latest pullet weighing was a group one (no individual weights).
 */
export function houseFigure(
  batch: KpiArgs[0] & { species: ProductionType },
  entries: KpiArgs[1],
  weighings: readonly Weighed[],
  today: FarmDay,
  sold: KpiArgs[4] = [],
): { kind: "fcr" | "uniformity"; value: number } | null {
  if (batch.species === "pullet") {
    const last = latest(weighings);
    const value = last ? uniformityPercent({ weightsGrams: last.weightsGrams }) : null;
    return value === null ? null : { kind: "uniformity", value };
  }
  if (batch.species !== "broiler" && batch.species !== "turkey") return null;
  const value = batchKpis(batch, entries, weighings, today, sold).weighed?.fcr ?? null;
  return value === null ? null : { kind: "fcr", value };
}

/**
 * SPEC-m3 D1: broilers, turkeys and pullets show the latest weighing's average weight and, when the curve of the batch's
 * sex (R6) covers the birds' age that day, its gap to the standard (as the weighing form). Null for the other types or
 * before a weighing; `standard` null without a curve (none is seeded: OQ5).
 */
export function houseWeight(
  batch: Aged & { species: ProductionType; sex?: BirdSex | null },
  weighings: readonly KpiArgs[2][number][],
  curves: readonly { sex?: BirdSex; points: Parameters<typeof standardAt>[0] }[],
): { averageGrams: number; standard: { grams: number; gapPercent: number } | null } | null {
  if (batch.species !== "broiler" && batch.species !== "turkey" && batch.species !== "pullet") return null;
  const last = latest(weighings);
  if (!last) return null;
  const averageGrams = Math.round(last.totalGrams / last.count); // as batchKpis
  const curve = curveFor(curves, batch.sex ?? "mixed");
  const grams = curve && standardAt(curve.points, ageOfBatch(batch, last.day as FarmDay))?.bodyWeightGrams;
  return { averageGrams, standard: grams ? { grams, gapPercent: versusStandard(averageGrams, grams) } : null };
}

/**
 * SPEC-m3 D1, E5: a layer day's hen-day rate (%) against the latest laying curve of its strain (R7) at the birds' week
 * of age that day (as the batch screen), the gap in points. Null without a curve or a rate for that week.
 */
export function layingVersusStandard(
  batch: Aged,
  day: string,
  ratePercent: number,
  curves: readonly { points: Parameters<typeof layingStandardAt>[0] }[],
): { standardPercent: number; gapPoints: number } | null {
  const points = curves.at(-1)?.points;
  const permille = points && layingStandardAt(points, Math.floor(ageOfBatch(batch, day as FarmDay) / 7))?.layingRatePermille;
  if (permille == null) return null;
  return { standardPercent: permille / 10, gapPoints: Math.round(ratePercent * 10 - permille) / 10 };
}
