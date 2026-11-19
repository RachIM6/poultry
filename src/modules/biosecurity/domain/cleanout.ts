import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC-m2-compliance BS4–BS5: clean-out of a house between two batches, then downtime (vide sanitaire).

/** SCOPE §4's checklist, in its order. Steps may be marked out of order, each once. */
export const CLEANOUT_STEPS = ["manureOut", "equipmentWashed", "pressureWash", "disinfection", "rodentControl", "waterFlush", "litterPreheat"] as const;
export type CleanoutStep = (typeof CLEANOUT_STEPS)[number];

export function checkStep(done: readonly { step: CleanoutStep }[], next: { step: CleanoutStep; product: string | null }): Result<void, "STEP_ALREADY_DONE" | "DISINFECTANT_REQUIRED"> {
  if (done.some((s) => s.step === next.step)) return fail("STEP_ALREADY_DONE");
  if (next.step === "disinfection" && !next.product?.trim()) return fail("DISINFECTANT_REQUIRED"); // SCOPE §4: product, dose, date
  return ok(undefined);
}

/** BS5: downtime starts on the disinfection day, which is day 1. */
export const downtimeDay = (disinfectedOn: FarmDay, today: FarmDay) => daysBetween(disinfectedOn, today) + 1;

/**
 * BS5: placing a batch before the farm's own minimum gives a warning, never a block. The minimum is the owner's
 * choice: no default until ONSSA or a vet gives one (CQ3).
 */
export function downtimeWarning(minDays: number | null, disinfectedOn: FarmDay | null, placedOn: FarmDay) {
  if (minDays === null || disinfectedOn === null) return null;
  const elapsedDays = daysBetween(disinfectedOn, placedOn);
  return elapsedDays < minDays ? { elapsedDays, minDays } : null;
}
