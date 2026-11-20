import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC-m4 §2, CL1, CL3: the farm's climate targets per batch age are dated configuration entered by the owner from a
// source they name (MQ1). No value is built in: with no target, a reading is "none" and alerts nobody.

type Day = string; // farm day

/** One age band of a target set. A null bound is not set: that side is never judged. */
export type Band = {
  fromAge: number;
  toAge: number; // inclusive
  temperatureMinTenths: number | null; // tenths of °C
  temperatureMaxTenths: number | null;
  humidityMin: number | null; // % relative humidity
  humidityMax: number | null;
  ammoniaMax: number | null; // ppm
};
/** `productionType`: the batches it is for (SPEC-m3); absent or null, every type without a set of its own. */
export type TargetSet = { id: string; validFrom: Day; source: string; bands: Band[]; productionType?: string | null };

const latest = (sets: TargetSet[], day: Day) =>
  sets.filter((s) => s.validFrom <= day).sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.id.localeCompare(b.id)).at(-1) ?? null;

/**
 * The set in force on a day: the latest `validFrom` on or before it (a later save of the same day wins: UUIDv7 ids),
 * among the sets for this production type, else among those for every type.
 */
export const setOn = (sets: TargetSet[], day: Day, productionType?: string): TargetSet | null =>
  (productionType ? latest(sets.filter((s) => s.productionType === productionType), day) : null) ?? latest(sets.filter((s) => !s.productionType), day);

/** The band for a batch of this type and age on that day, or null (no set, or no band covers the age). */
export const targetFor = (sets: TargetSet[], day: Day, age: number, productionType?: string): Band | null =>
  setOn(sets, day, productionType)?.bands.find((b) => b.fromAge <= age && age <= b.toAge) ?? null;

export type BandError = "INVALID_BAND" | "TARGET_BANDS_OVERLAP";

/** CL1: each band reads from ≤ to and min ≤ max; no two bands cover the same age. */
export function checkBands(bands: Band[]): Result<void, BandError> {
  const lowHigh = (lo: number | null, hi: number | null) => lo === null || hi === null || lo <= hi;
  if (bands.some((b) => b.fromAge > b.toAge || !lowHigh(b.temperatureMinTenths, b.temperatureMaxTenths) || !lowHigh(b.humidityMin, b.humidityMax))) return fail("INVALID_BAND");
  const sorted = [...bands].sort((a, b) => a.fromAge - b.fromAge);
  if (sorted.some((b, i) => i > 0 && b.fromAge <= sorted[i - 1].toAge)) return fail("TARGET_BANDS_OVERLAP");
  return ok(undefined);
}

export type Verdict = "below" | "within" | "above" | "none";
export type Reading = { temperatureTenths: number; humidity: number; ammonia: number | null };
export type Verdicts = { temperature: Verdict; humidity: Verdict; ammonia: Verdict };

const judge = (value: number | null, min: number | null, max: number | null): Verdict =>
  value === null || (min === null && max === null) ? "none" : min !== null && value < min ? "below" : max !== null && value > max ? "above" : "within";

/** CL3: each value against the band; "none" when there is no band, no bound, or no value (ammonia not measured). */
export function verdicts(r: Reading, band: Band | null): Verdicts {
  if (!band) return { temperature: "none", humidity: "none", ammonia: "none" };
  return {
    temperature: judge(r.temperatureTenths, band.temperatureMinTenths, band.temperatureMaxTenths),
    humidity: judge(r.humidity, band.humidityMin, band.humidityMax),
    ammonia: judge(r.ammonia, null, band.ammoniaMax),
  };
}

/** CL4: does this reading call for an alert? */
export const outOfRange = (v: Verdicts) => Object.values(v).some((x) => x === "below" || x === "above");
