import { addFarmDays, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC H1 + SPEC-m5 PA4: the vet (or the owner, a manager) edits a batch's plan after it was made: a line added by hand,
// a line moved to another day of age, a line cancelled. Pure: the phone runs the same checks as the server. The
// vaccine and its day always come from the person editing, never from a default (OQ4).

type Batch = { placedOn: FarmDay; ageAtPlacementDays?: number; status: "open" | "closed" };
export type PlanEditError = "ALREADY_DONE" | "BATCH_CLOSED" | "DAY_BEFORE_PLACEMENT";

/**
 * The due day of a line on `dayOfAge`, counted as the plan counts it (placement day = the age the birds arrived at).
 * A day of age before the birds arrived has no due day on this farm.
 */
export function lineDueOn(batch: Batch, dayOfAge: number): Result<FarmDay, "DAY_BEFORE_PLACEMENT"> {
  const ageAtPlacement = batch.ageAtPlacementDays ?? 0;
  return dayOfAge < ageAtPlacement ? fail("DAY_BEFORE_PLACEMENT") : ok(addFarmDays(batch.placedOn, dayOfAge - ageAtPlacement));
}

/** A line may be added while the batch is open, on a day of age the birds are on the farm. */
export function checkAdd(batch: Batch, dayOfAge: number): Result<FarmDay, PlanEditError> {
  if (batch.status !== "open") return fail("BATCH_CLOSED");
  return lineDueOn(batch, dayOfAge);
}

/** A line given stays as it was (H2, H6); only a line not yet done, on an open batch, is moved or cancelled. */
export function checkEdit(line: { done: unknown }, batch: Batch): Result<void, PlanEditError> {
  if (line.done) return fail("ALREADY_DONE");
  if (batch.status !== "open") return fail("BATCH_CLOSED");
  return ok(undefined);
}

/**
 * The line moved to `dayOfAge`. When its due day changes, its reminders (H2) go out again for the new day: the reminder
 * job finds lines by due day, so the old day no longer matches.
 */
export function moveLine(line: { done: unknown; dueOn: string }, batch: Batch, dayOfAge: number): Result<{ dayOfAge: number; dueOn: FarmDay; remindAgain: boolean }, PlanEditError> {
  const editable = checkEdit(line, batch);
  if (!editable.ok) return editable;
  const dueOn = lineDueOn(batch, dayOfAge);
  if (!dueOn.ok) return dueOn;
  return ok({ dayOfAge, dueOn: dueOn.value, remindAgain: dueOn.value !== line.dueOn });
}

/**
 * SPEC B1: the batch's placement day corrected. A line keeps its day of age, so each line not yet done (one moved by
 * hand too) is due that many days after the new placement; a line given keeps the day it was given (H2). Returns the
 * lines whose due day changes, on their new day.
 */
export function movedWithPlacement<L extends { done: unknown; dayOfAge: number; dueOn: string }>(lines: readonly L[], batch: Batch): (L & { dueOn: FarmDay })[] {
  return lines.flatMap((line) => {
    const dueOn = line.done ? null : lineDueOn(batch, line.dayOfAge);
    return dueOn?.ok && dueOn.value !== line.dueOn ? [{ ...line, dueOn: dueOn.value }] : [];
  });
}

/**
 * SPEC B1: the placement day stays on or before the first day health recorded on the batch (a vaccine given, a treatment
 * started, a vet visit), or that record would come before the birds arrived.
 */
export function checkPlacementBeforeRecords(placedOn: FarmDay, recorded: readonly string[]): Result<void, "PLACEMENT_AFTER_HEALTH_RECORD"> {
  return recorded.some((day) => day < placedOn) ? fail("PLACEMENT_AFTER_HEALTH_RECORD") : ok(undefined);
}
