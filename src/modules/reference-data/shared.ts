// What the phone's screens need from reference-data, without Zod (ADR-009). Also imported by prisma/seed.ts under
// plain Node (through ./schema.ts): no "@/" imports here.

export const PRODUCT_KINDS = ["feed", "vaccine", "medicine"] as const;
export const VACCINATION_METHODS = ["drinkingWater", "spray", "eyeDrop", "injection"] as const;

type Point = { day: number; bodyWeightGrams: number; cumulativeFeedGrams: number };

/**
 * The strain standard at an age (R1). Published tables may skip days: between two of them the value is linear,
 * rounded to the gram. Null outside the table: a standard is never extrapolated.
 */
export function standardAt(points: readonly Point[], day: number) {
  const next = points.findIndex((p) => p.day >= day);
  if (next === -1 || (next === 0 && points[0].day !== day)) return null;
  const hi = points[next];
  if (hi.day === day) return { bodyWeightGrams: hi.bodyWeightGrams, cumulativeFeedGrams: hi.cumulativeFeedGrams };
  const lo = points[next - 1];
  const t = (day - lo.day) / (hi.day - lo.day);
  const at = (a: number, b: number) => Math.round(a + (b - a) * t);
  return { bodyWeightGrams: at(lo.bodyWeightGrams, hi.bodyWeightGrams), cumulativeFeedGrams: at(lo.cumulativeFeedGrams, hi.cumulativeFeedGrams) };
}

export const REFERENCE_MUTATIONS = {
  copyProtocol: "reference-data.copyProtocol",
  updateProtocol: "reference-data.updateProtocol",
} as const;
