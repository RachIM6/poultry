import { addFarmDays, daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC H3–H5. Pure: the phone shows the banner, and the server will block sales (T21), with this same rule.
// TODO(spec OQ4): a vet confirms that the withdrawal runs through its end day, so a sale is allowed from the day after.

/** H3: the last farm day of a treatment's withdrawal: its end day + the product's withdrawal days. */
export const withdrawalEnd = (t: { endOn: FarmDay; withdrawalDays: number }) => addFarmDays(t.endOn, t.withdrawalDays);

/**
 * H4, V3: the day the batch's withdrawal runs until, seen on `day`, or null when none is running. A treatment counts from
 * its start day: birds sold before it began never had the medicine. Overlaps: the latest end.
 */
export function withdrawalUntil(treatments: readonly { startOn: FarmDay; endOn: FarmDay; withdrawalDays: number }[], day: FarmDay): FarmDay | null {
  let until: FarmDay | null = null;
  for (const t of treatments) {
    const end = withdrawalEnd(t);
    if (daysBetween(t.startOn, day) >= 0 && daysBetween(day, end) >= 0 && (!until || end > until)) until = end;
  }
  return until;
}

/** SPEC-m3 H7: the last farm day eggs are withheld after a treatment; null when it has no egg withdrawal. */
export const eggWithdrawalEnd = (t: { endOn: FarmDay; eggWithdrawalDays: number | null }) => (t.eggWithdrawalDays === null ? null : addFarmDays(t.endOn, t.eggWithdrawalDays));

type EggTreatment = { startOn: FarmDay; endOn: FarmDay; eggWithdrawalDays: number | null };

/** SPEC-m3 H7: the day eggs are withheld until, seen on `day` (the same rule as H4, with the egg days). */
export const eggWithdrawalUntil = (treatments: readonly EggTreatment[], day: FarmDay) =>
  withdrawalUntil(treatments.flatMap((t) => (t.eggWithdrawalDays === null ? [] : [{ ...t, withdrawalDays: t.eggWithdrawalDays }])), day);

/**
 * SPEC-m3 H7, V6: the laying days whose eggs may not be sold, one window per treatment, from its first day to its egg
 * withdrawal's last. ⚠️ OQ4 / MQ4: to be validated by a vet.
 */
export const eggWithdrawalWindows = (treatments: readonly EggTreatment[]) =>
  treatments.flatMap((t) => (t.eggWithdrawalDays === null ? [] : [{ from: t.startOn, to: addFarmDays(t.endOn, t.eggWithdrawalDays) }]));

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
  batch: { placedOn: FarmDay; status: "open" | "closed"; species?: string },
  t: { startOn: FarmDay; endOn: FarmDay; quantity: number; eggWithdrawalDays?: number | null },
  today: FarmDay,
): Result<void, BatchDayError | "END_BEFORE_START" | "INVALID_QUANTITY" | "EGG_WITHDRAWAL_REQUIRED"> {
  const started = checkBatchDay(batch, t.startOn, today);
  if (!started.ok) return started;
  if (daysBetween(t.startOn, t.endOn) < 0) return fail("END_BEFORE_START");
  if (!Number.isSafeInteger(t.quantity) || t.quantity <= 0) return fail("INVALID_QUANTITY");
  // SPEC-m3 H7: a laying hen's eggs carry the medicine too; the days come from the label or the prescription (MQ4).
  if (batch.species === "layer" && (t.eggWithdrawalDays === null || t.eggWithdrawalDays === undefined)) return fail("EGG_WITHDRAWAL_REQUIRED");
  return ok(undefined);
}
