import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC B3. Pure and isomorphic: the phone shows the result as the sample is typed, the server stores the sample.

/** A sample: each bird's weight, or only the total of `count` birds weighed together. Grams. */
export type Sample = { weightsGrams: number[] } | { totalGrams: number; count: number };

export const MAX_SAMPLE = 1000; // birds in one sample
const MAX_BIRD_GRAMS = 20_000;

export function checkSample(s: Sample): Result<void, "INVALID_SAMPLE"> {
  const valid =
    "weightsGrams" in s
      ? s.weightsGrams.length > 0 && s.weightsGrams.length <= MAX_SAMPLE && s.weightsGrams.every((g) => Number.isSafeInteger(g) && g > 0 && g <= MAX_BIRD_GRAMS)
      : Number.isSafeInteger(s.count) && s.count > 0 && s.count <= MAX_SAMPLE && Number.isSafeInteger(s.totalGrams) && s.totalGrams > 0 && s.totalGrams <= s.count * MAX_BIRD_GRAMS;
  return valid ? ok(undefined) : fail("INVALID_SAMPLE");
}

/**
 * Average weight (grams, rounded) and uniformity as CV% = standard deviation / mean × 100, one decimal. The standard
 * deviation is the sample one (n − 1): the birds weighed stand for the whole house. CV needs individual weights.
 */
export function sampleStats(s: Sample): { count: number; averageGrams: number; cvPercent: number | null } {
  if (!("weightsGrams" in s)) return { count: s.count, averageGrams: Math.round(s.totalGrams / s.count), cvPercent: null };
  const n = s.weightsGrams.length;
  const mean = s.weightsGrams.reduce((a, g) => a + g, 0) / n;
  if (n < 2) return { count: n, averageGrams: Math.round(mean), cvPercent: null };
  const variance = s.weightsGrams.reduce((a, g) => a + (g - mean) ** 2, 0) / (n - 1);
  return { count: n, averageGrams: Math.round(mean), cvPercent: Math.round((Math.sqrt(variance) / mean) * 1000) / 10 };
}

/** How far the average is from the strain standard at that age, in % with one decimal: +3.2 is 3.2 % heavier. */
export const versusStandard = (averageGrams: number, standardGrams: number) => Math.round((averageGrams / standardGrams - 1) * 1000) / 10;

/** SPEC-m3 B12 (MQ9): uniformity is the share of birds within ±10 % of the sample's mean, the pullet guides' measure. */
export const UNIFORMITY_BAND_PERCENT = 10;

/** SPEC-m3 B12: uniformity %, one decimal, from individual weights; null for a group weighing or one bird. */
export function uniformityPercent(s: Sample, bandPercent = UNIFORMITY_BAND_PERCENT): number | null {
  if (!("weightsGrams" in s) || s.weightsGrams.length < 2) return null;
  const mean = s.weightsGrams.reduce((a, g) => a + g, 0) / s.weightsGrams.length;
  const within = s.weightsGrams.filter((g) => Math.abs(g - mean) * 100 <= mean * bandPercent).length;
  return Math.round((within / s.weightsGrams.length) * 1000) / 10;
}
