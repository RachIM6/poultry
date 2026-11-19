import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { birdsOut, type DayFields } from "@/modules/flock/domain/daily-entry";

// SPEC B1 (placement); daily entries, weighings and closing join this aggregate in T16–T24. Pure and isomorphic: the
// phone and the server run the same rules (poultry-ddd §3.1).

export type BatchStatus = "open" | "closed";
const TRANSITIONS: Record<BatchStatus, readonly BatchStatus[]> = { open: ["closed"], closed: [] }; // no reopening in v1

export type Placement = {
  id: string;
  farmId: string;
  houseId: string;
  strainId: string;
  placedOn: FarmDay;
  chicksPlaced: number;
  deadOnArrival: number;
  hatchery: string;
  deliveryNote: string;
  chickUnitPriceCentimes: bigint;
  dayOldWeightGrams: number | null; // average, optional
};

export type PlacementError = "INVALID_QUANTITY" | "DEAD_ON_ARRIVAL_TOO_HIGH" | "PLACEMENT_IN_FUTURE";

/** Age in days on a farm day: the placement day is day 0, as in the breeders' standard tables. */
export const ageOn = (placedOn: FarmDay, day: FarmDay) => daysBetween(placedOn, day);

export class Batch {
  private constructor(
    readonly placement: Placement,
    private _status: BatchStatus,
  ) {}

  /** B1: a new batch. `today` is the farm day by the caller's clock. "One open batch per house" needs every batch of
   * the house, so the use case checks it (and the database enforces it), not the aggregate. */
  static place(p: Placement, today: FarmDay): Result<Batch, PlacementError> {
    if (!Number.isSafeInteger(p.chicksPlaced) || p.chicksPlaced <= 0) return fail("INVALID_QUANTITY");
    if (!Number.isSafeInteger(p.deadOnArrival) || p.deadOnArrival < 0) return fail("INVALID_QUANTITY");
    if (p.deadOnArrival >= p.chicksPlaced) return fail("DEAD_ON_ARRIVAL_TOO_HIGH");
    if (p.chickUnitPriceCentimes < 0n || (p.dayOldWeightGrams !== null && p.dayOldWeightGrams <= 0)) return fail("INVALID_QUANTITY");
    if (daysBetween(p.placedOn, today) < 0) return fail("PLACEMENT_IN_FUTURE");
    return ok(new Batch(p, "open"));
  }

  static rehydrate(p: Placement, status: BatchStatus) {
    return new Batch(p, status);
  }

  get status() {
    return this._status;
  }

  ageOn(day: FarmDay): number {
    return ageOn(this.placement.placedOn, day);
  }

  /** Birds actually started: placed minus dead on arrival. Mortality and sales lower it from T16. */
  get birdsStarted() {
    return this.placement.chicksPlaced - this.placement.deadOnArrival;
  }

  canBecome(next: BatchStatus) {
    return TRANSITIONS[this._status].includes(next);
  }

  /**
   * B2: may this be the day's entry? `outOnOtherDays` = dead + culled on the batch's other days, so the check also
   * holds when an edit raises an earlier day. Editing is allowed until the batch is closed.
   */
  checkDay(day: FarmDay, entry: DayFields, outOnOtherDays: number, today: FarmDay): Result<void, DayError> {
    if (this._status !== "open") return fail("BATCH_CLOSED");
    if (ageOn(this.placement.placedOn, day) < 0) return fail("DAY_BEFORE_PLACEMENT");
    if (daysBetween(day, today) < 0) return fail("DAY_IN_FUTURE");
    const counts = [entry.dead, entry.culled, entry.waterMl ?? 0];
    if (counts.some((n) => !Number.isSafeInteger(n) || n < 0)) return fail("INVALID_QUANTITY");
    if (entry.feed && (!Number.isSafeInteger(entry.feed.grams) || entry.feed.grams <= 0)) return fail("INVALID_QUANTITY");
    if (outOnOtherDays + birdsOut(entry) > this.birdsStarted) return fail("MORE_DEAD_THAN_ON_HAND");
    return ok(undefined);
  }
}

export type DayError = "BATCH_CLOSED" | "DAY_BEFORE_PLACEMENT" | "DAY_IN_FUTURE" | "INVALID_QUANTITY" | "MORE_DEAD_THAN_ON_HAND";
