import type { FarmDay } from "@/lib/kernel/farm-day";
import { ageOfBatch, type BatchDto } from "@/modules/flock/shared";

type T = (key: string, values?: Record<string, string>) => string;

/** SPEC-m3 B7: the birds' age, in days for broilers and in weeks (+ days) for the longer cycles. */
export function ageText(t: T, b: Pick<BatchDto, "species" | "placedOn" | "ageAtPlacementDays">, day: FarmDay) {
  const age = ageOfBatch(b, day);
  if (b.species === "broiler") return t("Batches.age", { age: String(age) });
  const [weeks, days] = [Math.floor(age / 7), age % 7];
  return days === 0 ? t("Batches.ageWeeks", { weeks: String(weeks) }) : t("Batches.ageWeeksDays", { weeks: String(weeks), days: String(days) });
}
