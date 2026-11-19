import { addFarmDays, daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC H1, H2. Pure: the phone builds the same plan and runs the same checks as the server.

/** One line of a farm's protocol (reference-data's ProtocolItem): a vaccine on a day of age. */
export type ProtocolLine<M extends string = string> = { dayOfAge: number; productId: string; method: M };
export type PlannedVaccination<M extends string = string> = ProtocolLine<M> & { dueOn: FarmDay };

/**
 * H1: the batch's plan, in the order it is given. Due day = placement day + day of age (the placement day is day 0, as
 * for the batch's age). Lines on the same day keep the protocol's order, so every phone numbers them the same way.
 */
export function planVaccinations<M extends string>(placedOn: FarmDay, protocol: readonly ProtocolLine<M>[]): PlannedVaccination<M>[] {
  return [...protocol].sort((a, b) => a.dayOfAge - b.dayOfAge).map((line) => ({ ...line, dueOn: addFarmDays(placedOn, line.dayOfAge) }));
}

export type DoneError = "ALREADY_DONE" | "BATCH_CLOSED" | "DAY_BEFORE_PLACEMENT" | "DAY_IN_FUTURE" | "INVALID_QUANTITY";

/** H2: may this vaccination be marked done on `on` with `doses`? Once, while the batch is open, between placement and today. */
export function checkDone(
  vaccination: { done: unknown },
  batch: { placedOn: FarmDay; status: "open" | "closed" },
  on: FarmDay,
  doses: number,
  today: FarmDay,
): Result<void, DoneError> {
  if (vaccination.done) return fail("ALREADY_DONE");
  if (batch.status !== "open") return fail("BATCH_CLOSED");
  if (daysBetween(batch.placedOn, on) < 0) return fail("DAY_BEFORE_PLACEMENT");
  if (daysBetween(on, today) < 0) return fail("DAY_IN_FUTURE");
  if (!Number.isSafeInteger(doses) || doses <= 0) return fail("INVALID_QUANTITY");
  return ok(undefined);
}

export type VaccinationStatus = "done" | "late" | "today" | "upcoming";

export function statusOn(vaccination: { dueOn: FarmDay; done: unknown }, today: FarmDay): VaccinationStatus {
  if (vaccination.done) return "done";
  const ahead = daysBetween(today, vaccination.dueOn);
  return ahead < 0 ? "late" : ahead === 0 ? "today" : "upcoming";
}

/** H2: a vaccination not yet done is announced the day before its due day, then on the day. */
export type Reminder = "dayBefore" | "dueDay";

/** The due day of the vaccinations that get each reminder on `today`. */
export const remindedDueOn = (today: FarmDay): Record<Reminder, FarmDay> => ({ dayBefore: addFarmDays(today, 1), dueDay: today });
