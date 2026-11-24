import type { FarmDay } from "@/lib/kernel/farm-day";
import type { ProductionType } from "@/modules/reference-data/shared";
import { batchKpis } from "@/modules/flock/domain/kpi";
import { uniformityPercent } from "@/modules/flock/domain/weighing";

type KpiArgs = Parameters<typeof batchKpis>;
/** `weightsGrams` is empty for a group weighing (as WeighingDto). */
type Weighed = KpiArgs[2][number] & { weightsGrams: number[] };

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
    const last = [...weighings].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id)).at(-1); // as batchKpis
    const value = last ? uniformityPercent({ weightsGrams: last.weightsGrams }) : null;
    return value === null ? null : { kind: "uniformity", value };
  }
  if (batch.species !== "broiler" && batch.species !== "turkey") return null;
  const value = batchKpis(batch, entries, weighings, today, sold).weighed?.fcr ?? null;
  return value === null ? null : { kind: "fcr", value };
}
