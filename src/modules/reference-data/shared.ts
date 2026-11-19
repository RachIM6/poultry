// What the phone's screens need from reference-data, without Zod (ADR-009). Also imported by prisma/seed.ts under
// plain Node (through ./schema.ts): no "@/" imports here.

/** SPEC-m3 §2, R5: what a batch produces. Stored on the batch (`Batch.species`); every M1 batch is a broiler one. */
export const PRODUCTION_TYPES = ["broiler", "turkey", "pullet", "layer", "beldi", "duck", "quail"] as const;
export type ProductionType = (typeof PRODUCTION_TYPES)[number];

/** SPEC-m3 R6: the birds a growth curve (and a batch) is for. */
export const BIRD_SEXES = ["mixed", "female", "male"] as const;
export type BirdSex = (typeof BIRD_SEXES)[number];

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

/**
 * R6: the growth curve a batch of this sex compares with: the latest version published for its sex, else the latest
 * mixed one. Curves come ordered by version; a phone's cached reference from before M3 has no sex (= mixed).
 */
export function curveFor<C extends { sex?: BirdSex }>(curves: readonly C[], sex: BirdSex): C | null {
  const of = (x: BirdSex) => curves.filter((c) => (c.sex ?? "mixed") === x).at(-1);
  return of(sex) ?? of("mixed") ?? null;
}

type LayingPoint = {
  week: number;
  layingRatePermille: number | null;
  eggsPerHenHousedTenths: number | null;
  eggWeightDg: number | null;
  feedGramsPerHenDay: number | null;
  bodyWeightGrams: number | null;
};
export type LayingValues = Omit<LayingPoint, "week">;
const LAYING_FIELDS = ["layingRatePermille", "eggsPerHenHousedTenths", "eggWeightDg", "feedGramsPerHenDay", "bodyWeightGrams"] as const;

/**
 * R7: the laying standard at a week of age (fractional weeks allowed: days / 7). Linear between published weeks,
 * rounded; a value missing on either side stays null. Null outside the table: never extrapolated.
 */
export function layingStandardAt(points: readonly LayingPoint[], week: number): LayingValues | null {
  const next = points.findIndex((p) => p.week >= week);
  if (next === -1 || (next === 0 && points[0].week !== week)) return null;
  const hi = points[next];
  const lo = hi.week === week ? hi : points[next - 1];
  const t = hi === lo ? 0 : (week - lo.week) / (hi.week - lo.week);
  const at = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round(a + (b - a) * t));
  return Object.fromEntries(LAYING_FIELDS.map((f) => [f, at(lo[f], hi[f])])) as LayingValues;
}
