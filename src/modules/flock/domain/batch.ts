import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { birdsOut, type DayFields } from "@/modules/flock/domain/daily-entry";
import { checkSample, type Sample } from "@/modules/flock/domain/weighing";
import type { BirdSex, ProductionType } from "@/modules/reference-data/shared";

// SPEC B1 (placement); daily entries, weighings and closing join this aggregate in T16–T24. Pure and isomorphic: the
// phone and the server run the same rules (poultry-ddd §3.1).

export type BatchStatus = "open" | "closed";
const TRANSITIONS: Record<BatchStatus, readonly BatchStatus[]> = { open: ["closed"], closed: ["open"] }; // reopened by the owner (domain/reopen.ts)

/** SPEC-m3 B13: the close reason of a pullet batch moved to laying (a code, shown translated). */
export const TRANSFER_REASON = "transferToLaying";

export type Placement = {
  id: string;
  farmId: string;
  houseId: string;
  species: ProductionType; // SPEC-m3 R5
  strainId: string;
  placedOn: FarmDay;
  chicksPlaced: number;
  deadOnArrival: number;
  hatchery: string;
  deliveryNote: string;
  chickUnitPriceCentimes: bigint;
  dayOldWeightGrams: number | null; // average, optional
  ageAtPlacementDays?: number; // SPEC-m3 B7: absent or 0 for day-old chicks
  sex?: BirdSex; // SPEC-m3 B9: absent or mixed, except turkeys raised by sex
  freeChicks?: number; // SPEC-m3 B10: the hatchery's free supplement, placed but not billed
  parentFlock?: string | null;
  weakChicks?: number | null;
  litterTempTenths?: number | null;
  fromBatchId?: string | null; // SPEC-m3 B13
};

/** SPEC-m3 B10: birds placed (delivered): billed + the hatchery's free supplement. */
export const birdsPlaced = (b: { chicksPlaced: number; freeChicks?: number }) => b.chicksPlaced + (b.freeChicks ?? 0);

/** SPEC-m3 B10: birds that started the batch: birds placed − dead on arrival. */
export const birdsStarted = (b: { chicksPlaced: number; freeChicks?: number; deadOnArrival: number }) => birdsPlaced(b) - b.deadOnArrival;

/**
 * SPEC-m3 B10: is dead on arrival above the farm's claim threshold (per mille of the chicks delivered)? Never without a
 * threshold: none is assumed (MQ6).
 */
export const doaClaim = (b: { chicksPlaced: number; freeChicks?: number; deadOnArrival: number }, thresholdPermille: number | null | undefined) =>
  !!thresholdPermille && b.deadOnArrival * 1000 > thresholdPermille * birdsPlaced(b);

export type PlacementError = "INVALID_QUANTITY" | "DEAD_ON_ARRIVAL_TOO_HIGH" | "PLACEMENT_IN_FUTURE" | "INVALID_INPUT";

/** SPEC-m3 B9: the types raised by sex in separate batches. */
const SEXED_TYPES: readonly ProductionType[] = ["turkey"];

/** Days since placement on a farm day: the placement day is day 0, as in the breeders' standard tables. */
export const ageOn = (placedOn: FarmDay, day: FarmDay) => daysBetween(placedOn, day);

/** SPEC-m3 B7: the birds' age on a farm day, for birds placed older than a day (started pullets, point-of-lay hens). */
export const ageOfBatch = (b: { placedOn: string; ageAtPlacementDays?: number }, day: FarmDay) => ageOn(b.placedOn as FarmDay, day) + (b.ageAtPlacementDays ?? 0);

/** Longest cycle of SPEC-m3 §2 (layers, 80+ weeks), with room: an age above it is a typing error. */
const MAX_AGE_DAYS = 600;

type InHouse = { species: ProductionType; sex?: BirdSex };

/**
 * SPEC-m3 B8, B9: may this batch join a house whose open batches are these? One open batch per house, except beldi
 * bands, which share a run, and a turkey batch of one sex next to the other sex's.
 */
export function canJoinHouse(type: ProductionType, open: readonly InHouse[], sex: BirdSex = "mixed"): Result<void, "HOUSE_HAS_OPEN_BATCH"> {
  if (open.length === 0 || (type === "beldi" && open.every((b) => b.species === "beldi"))) return ok(undefined);
  const other = open.length === 1 ? open[0] : null;
  const pair = other && sex !== "mixed" && other.species === type && (other.sex ?? "mixed") !== "mixed" && other.sex !== sex;
  return pair ? ok(undefined) : fail("HOUSE_HAS_OPEN_BATCH");
}

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
    const extra = [p.freeChicks ?? 0, p.weakChicks ?? 0];
    if (extra.some((n) => !Number.isSafeInteger(n) || n < 0)) return fail("INVALID_QUANTITY");
    if (p.deadOnArrival >= birdsPlaced(p)) return fail("DEAD_ON_ARRIVAL_TOO_HIGH");
    if (p.chickUnitPriceCentimes < 0n || (p.dayOldWeightGrams !== null && p.dayOldWeightGrams <= 0)) return fail("INVALID_QUANTITY");
    if ((p.sex ?? "mixed") !== "mixed" && !SEXED_TYPES.includes(p.species)) return fail("INVALID_INPUT");
    const age = p.ageAtPlacementDays ?? 0;
    if (!Number.isSafeInteger(age) || age < 0 || age > MAX_AGE_DAYS) return fail("INVALID_QUANTITY");
    if (daysBetween(p.placedOn, today) < 0) return fail("PLACEMENT_IN_FUTURE");
    return ok(new Batch(p, "open"));
  }

  static rehydrate(p: Placement, status: BatchStatus) {
    return new Batch(p, status);
  }

  get status() {
    return this._status;
  }

  /** The birds' age on a farm day (SPEC-m3 B7). */
  ageOn(day: FarmDay): number {
    return ageOfBatch(this.placement, day);
  }

  /** Birds actually started: placed minus dead on arrival. Mortality and sales lower what is on hand. */
  get birdsStarted() {
    return birdsStarted(this.placement);
  }

  canBecome(next: BatchStatus) {
    return TRANSITIONS[this._status].includes(next);
  }

  /**
   * B2: may this be the day's entry? `onHand` = birds on hand counting the batch's other days only and every bird sold,
   * so the check also holds when an edit raises an earlier day. Editing is allowed until the batch is closed.
   */
  checkDay(day: FarmDay, entry: DayFields, onHand: number, today: FarmDay): Result<void, DayError> {
    const open = this.acceptsDataFor(day, today);
    if (!open.ok) return open;
    const counts = [entry.dead, entry.culled, entry.waterMl ?? 0];
    if (counts.some((n) => !Number.isSafeInteger(n) || n < 0)) return fail("INVALID_QUANTITY");
    if (entry.feed && (!Number.isSafeInteger(entry.feed.grams) || entry.feed.grams <= 0)) return fail("INVALID_QUANTITY");
    if (birdsOut(entry) > onHand) return fail("MORE_DEAD_THAN_ON_HAND");
    return ok(undefined);
  }

  /** B5: may `birds` leave alive (a sale, thinning or the last one) on this day, with `onHand` birds on hand? */
  checkBirdsSold(day: FarmDay, birds: number, onHand: number, today: FarmDay): Result<void, DataDayError | "INVALID_QUANTITY" | "MORE_BIRDS_THAN_ON_HAND"> {
    const open = this.acceptsDataFor(day, today);
    if (!open.ok) return open;
    if (!Number.isSafeInteger(birds) || birds <= 0) return fail("INVALID_QUANTITY");
    if (birds > onHand) return fail("MORE_BIRDS_THAN_ON_HAND");
    return ok(undefined);
  }

  /**
   * B6: closed on `day`, by the last sale or by hand. Afterwards nothing changes (entries, weighings, sales, health):
   * the final KPIs and the cost per kg are locked, until the owner reopens it (`reopen`).
   */
  close(day: FarmDay, today: FarmDay): Result<void, DataDayError> {
    const open = this.acceptsDataFor(day, today);
    if (!open.ok) return open;
    this._status = "closed";
    return ok(undefined);
  }

  /** B6 "Reopening": open again, once `checkReopen` (domain/reopen.ts) has passed. */
  reopen(): Result<void, "BATCH_NOT_CLOSED"> {
    if (!this.canBecome("open")) return fail("BATCH_NOT_CLOSED");
    this._status = "open";
    return ok(undefined);
  }

  /**
   * SPEC-m3 B13: may `hens` of this pullet batch move to a laying house on `day`? `onHand` = birds on hand that day.
   * The ones left behind are culled; the batch then closes.
   */
  checkTransfer(day: FarmDay, hens: number, onHand: number, today: FarmDay): Result<void, DataDayError | "INVALID_INPUT" | "INVALID_QUANTITY" | "MORE_BIRDS_THAN_ON_HAND"> {
    const open = this.acceptsDataFor(day, today);
    if (!open.ok) return open;
    if (this.placement.species !== "pullet") return fail("INVALID_INPUT");
    if (!Number.isSafeInteger(hens) || hens <= 0) return fail("INVALID_QUANTITY");
    return hens > onHand ? fail("MORE_BIRDS_THAN_ON_HAND") : ok(undefined);
  }

  /** B3: a weighing of this batch on this day. */
  checkWeighing(day: FarmDay, sample: Sample, today: FarmDay): Result<void, DataDayError | "INVALID_SAMPLE"> {
    const open = this.acceptsDataFor(day, today);
    return open.ok ? checkSample(sample) : open;
  }

  /** Data for a day (entry, weighing) while the batch is open, between its placement and today. */
  private acceptsDataFor(day: FarmDay, today: FarmDay): Result<void, DataDayError> {
    if (this._status !== "open") return fail("BATCH_CLOSED");
    if (ageOn(this.placement.placedOn, day) < 0) return fail("DAY_BEFORE_PLACEMENT");
    if (daysBetween(day, today) < 0) return fail("DAY_IN_FUTURE");
    return ok(undefined);
  }
}

type DataDayError = "BATCH_CLOSED" | "DAY_BEFORE_PLACEMENT" | "DAY_IN_FUTURE";
export type DayError = DataDayError | "INVALID_QUANTITY" | "MORE_DEAD_THAN_ON_HAND";
