import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { Batch, birdsStarted, type Placement, type PlacementError } from "@/modules/flock/domain/batch";

// SPEC B1 "Correcting a placement": a typing error in the placement is fixed while the batch is open. Its own file, out
// of batch.ts: batch.ts ships with /batches, which has no room to grow (SPEC §9.3); this one comes with the form's chunk.

/** What a correction may change. The production type and sex stay: they decide the batch's rules and its house. */
export type PlacementCorrection = Partial<
  Pick<Placement, "houseId" | "strainId" | "placedOn" | "chicksPlaced" | "freeChicks" | "deadOnArrival" | "hatchery" | "deliveryNote" | "chickUnitPriceCentimes">
>;

/** What the batch already recorded bounds a correction: its first day of data, the birds gone, when its house was free. */
export type Recorded = { firstDay: FarmDay | null; birdsOut: number; houseFreeFrom: FarmDay | null };

export type CorrectionError = PlacementError | "BATCH_CLOSED" | "BATCH_HAS_DATA" | "PLACEMENT_AFTER_DATA" | "PLACEMENT_OVERLAPS_PREVIOUS" | "FEWER_BIRDS_THAN_RECORDED";

/** `firstDay` and `birdsOut` from the batch's daily entries, weighings and birds sold. The server and the phone run this. */
export function recordedOf(entries: readonly { day: string; dead: number; culled: number }[], weighings: readonly { day: string }[], sold: readonly { day: string; birds: number }[]) {
  const firstDay = ([...entries, ...weighings, ...sold].map((r) => r.day).sort()[0] ?? null) as FarmDay | null;
  const birdsOut = entries.reduce((n, e) => n + e.dead + e.culled, 0) + sold.reduce((n, s) => n + s.birds, 0);
  return { firstDay, birdsOut };
}

/**
 * The day the house was last emptied before this batch: the latest closing of its other batches. In the batch's own
 * house, only those already closed on its placement day count (a turkey batch of the other sex may close later).
 */
export function houseFreeFrom(batch: { id: string; houseId: string; placedOn: string }, houseId: string, closed: readonly { id: string; houseId: string; closedOn?: string | null }[]) {
  const days = closed.flatMap((b) => (b.id !== batch.id && b.houseId === houseId && b.closedOn && (houseId !== batch.houseId || b.closedOn <= batch.placedOn) ? [b.closedOn] : []));
  return (days.sort().at(-1) ?? null) as FarmDay | null;
}

/**
 * B1: the batch's placement with `changes`, checked as a new placement (Batch.place), while the batch is open. Not a
 * batch made by a transfer (SPEC-m3 B13: its figures come from the pullets). The house changes only before any data;
 * the placement day stays on or before the first day of data and on or after the day the house was free; the birds
 * started stay at least the birds already gone. Whether the house takes the batch (B8) is the use case's to check.
 */
export function correctPlacement(batch: Batch, changes: PlacementCorrection, recorded: Recorded, today: FarmDay): Result<Batch, CorrectionError> {
  const was = batch.placement;
  if (batch.status !== "open") return fail("BATCH_CLOSED");
  if (was.fromBatchId) return fail("INVALID_INPUT");
  if (changes.houseId !== undefined && changes.houseId !== was.houseId && recorded.firstDay) return fail("BATCH_HAS_DATA");
  const next = Batch.place({ ...was, ...changes }, today);
  if (!next.ok) return next;
  const p = next.value.placement;
  if (recorded.firstDay && daysBetween(p.placedOn, recorded.firstDay) < 0) return fail("PLACEMENT_AFTER_DATA");
  if (recorded.houseFreeFrom && daysBetween(recorded.houseFreeFrom, p.placedOn) < 0) return fail("PLACEMENT_OVERLAPS_PREVIOUS");
  if (birdsStarted(p) < recorded.birdsOut) return fail("FEWER_BIRDS_THAN_RECORDED");
  return ok(next.value);
}
