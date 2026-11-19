import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC-m3 E1. Pure and isomorphic: the phone checks and totals a collection with the same code as the server.

/** P-EggCollect's rows. Normal and double-yolk eggs go to grading; cracked, dirty and floor eggs are downgraded; broken
 * eggs are lost (E2). */
export const EGG_CATEGORIES = ["normal", "cracked", "dirty", "doubleYolk", "floor", "broken"] as const;
export type EggCategory = (typeof EGG_CATEGORIES)[number];
export type EggCounts = Record<EggCategory, number>;

/** Optional: some eggs of the collection weighed together, for the average egg weight (E5). */
export type EggSample = { count: number; grams: number } | null;

export const EMPTY_COUNTS: EggCounts = { normal: 0, cracked: 0, dirty: 0, doubleYolk: 0, floor: 0, broken: 0 };

export const eggsIn = (c: EggCounts) => EGG_CATEGORIES.reduce((n, k) => n + c[k], 0);
/** E5: everything but normal and double-yolk eggs. */
export const downgradedIn = (c: EggCounts) => c.cracked + c.dirty + c.floor + c.broken;

export type CollectionError = "INVALID_INPUT" | "INVALID_QUANTITY" | "BATCH_CLOSED" | "DAY_BEFORE_PLACEMENT" | "DAY_IN_FUTURE";

/**
 * E1: may these eggs be recorded for this batch on `day`? Layer batches only, while open, between their placement and
 * today; whole, non-negative counts, at least one egg; a sample of at most the eggs collected.
 */
export function checkCollection(
  batch: { species: string; status: string; placedOn: FarmDay },
  day: FarmDay,
  counts: EggCounts,
  sample: EggSample,
  today: FarmDay,
): Result<void, CollectionError> {
  if (batch.species !== "layer") return fail("INVALID_INPUT");
  if (batch.status !== "open") return fail("BATCH_CLOSED");
  if (daysBetween(batch.placedOn, day) < 0) return fail("DAY_BEFORE_PLACEMENT");
  if (daysBetween(day, today) < 0) return fail("DAY_IN_FUTURE");
  if (EGG_CATEGORIES.some((k) => !Number.isSafeInteger(counts[k]) || counts[k] < 0) || eggsIn(counts) === 0) return fail("INVALID_QUANTITY");
  if (sample && (!Number.isSafeInteger(sample.count) || !Number.isSafeInteger(sample.grams) || sample.count <= 0 || sample.grams <= 0 || sample.count > eggsIn(counts))) {
    return fail("INVALID_QUANTITY");
  }
  return ok(undefined);
}
