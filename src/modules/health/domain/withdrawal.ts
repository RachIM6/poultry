import { addFarmDays, daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC H3–H5. Pure: the phone shows the banner, and the server will block sales (T21), with this same rule.
// TODO(spec OQ4): a vet confirms that the withdrawal runs through its end day, so a sale is allowed from the day after.

/** H3: the last farm day of a treatment's withdrawal: its end day + the product's withdrawal days. */
export const withdrawalEnd = (t: { endOn: FarmDay; withdrawalDays: number }) => addFarmDays(t.endOn, t.withdrawalDays);

/** H4: the day the batch's withdrawal runs until, seen on `today`, or null when none is running. Overlaps: the latest end. */
export function withdrawalUntil(treatments: readonly { endOn: FarmDay; withdrawalDays: number }[], today: FarmDay): FarmDay | null {
  let until: FarmDay | null = null;
  for (const t of treatments) {
    const end = withdrawalEnd(t);
    if (daysBetween(today, end) >= 0 && (!until || end > until)) until = end;
  }
  return until;
}

export type BatchDayError = "BATCH_CLOSED" | "DAY_BEFORE_PLACEMENT" | "DAY_IN_FUTURE";

/** H5 and the start of H3: something that happened to an open batch, between its placement and today. */
export function checkBatchDay(batch: { placedOn: FarmDay; status: "open" | "closed" }, on: FarmDay, today: FarmDay): Result<void, BatchDayError> {
  if (batch.status !== "open") return fail("BATCH_CLOSED");
  if (daysBetween(batch.placedOn, on) < 0) return fail("DAY_BEFORE_PLACEMENT");
  if (daysBetween(on, today) < 0) return fail("DAY_IN_FUTURE");
  return ok(undefined);
}

/** H3: started by today (it may still be running), ending on or after its start, with some medicine taken from stock. */
export function checkTreatment(
  batch: { placedOn: FarmDay; status: "open" | "closed" },
  t: { startOn: FarmDay; endOn: FarmDay; quantity: number },
  today: FarmDay,
): Result<void, BatchDayError | "END_BEFORE_START" | "INVALID_QUANTITY"> {
  const started = checkBatchDay(batch, t.startOn, today);
  if (!started.ok) return started;
  if (daysBetween(t.startOn, t.endOn) < 0) return fail("END_BEFORE_START");
  if (!Number.isSafeInteger(t.quantity) || t.quantity <= 0) return fail("INVALID_QUANTITY");
  return ok(undefined);
}
