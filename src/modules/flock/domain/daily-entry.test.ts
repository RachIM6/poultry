import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { Batch, type Placement } from "./batch";
import { EMPTY_DAY, changedFields, mergeDay, type DayFields } from "./daily-entry";

const day = (d: string) => d as FarmDay;
const placement: Placement = {
  id: "b1", farmId: "f1", houseId: "h1", strainId: "ross-308", placedOn: day("2026-10-14"), chicksPlaced: 1_000, deadOnArrival: 10,
  hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: 450n, dayOldWeightGrams: null,
};
const batch = Batch.rehydrate(placement, "open");
const feed = { stockItemId: "starter", grams: 85_000 };

describe("daily entry merge (SPEC B2, ADR-003 §5)", () => {
  it("two phones on the same day: the same field ends at the last write, other fields both survive", () => {
    const phoneA = changedFields(null, { ...EMPTY_DAY, dead: 3, feed });
    const phoneB = changedFields(null, { ...EMPTY_DAY, dead: 5, deathCause: "heat" });
    expect(phoneA).toEqual({ dead: 3, feed });
    const merged = mergeDay(mergeDay(null, phoneA), phoneB); // A reached the server first
    expect(merged).toEqual({ ...EMPTY_DAY, dead: 5, deathCause: "heat", feed });
  });

  it("an edit sends only what changed, so clearing a field is a change too", () => {
    const saved: DayFields = { ...EMPTY_DAY, dead: 2, feed, note: "ventilation" };
    expect(changedFields(saved, { ...saved, feed: { ...feed, grams: 90_000 } })).toEqual({ feed: { ...feed, grams: 90_000 } });
    expect(changedFields(saved, { ...saved, note: null })).toEqual({ note: null });
    expect(changedFields(saved, saved)).toEqual({});
  });
});

describe("Batch.checkDay (SPEC B2)", () => {
  const today = day("2026-11-06");
  const entry = { ...EMPTY_DAY, dead: 4, culled: 1 };

  it("accepts a day between placement and today, until the batch is closed", () => {
    expect(batch.checkDay(day("2026-10-14"), entry, 0, today).ok).toBe(true);
    expect(batch.checkDay(today, entry, 0, today).ok).toBe(true);
    expect(Batch.rehydrate(placement, "closed").checkDay(today, entry, 0, today)).toEqual({ ok: false, error: "BATCH_CLOSED" });
    expect(batch.checkDay(day("2026-10-13"), entry, 0, today)).toEqual({ ok: false, error: "DAY_BEFORE_PLACEMENT" });
    expect(batch.checkDay(day("2026-11-07"), entry, 0, today)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
  });

  it("never takes out more birds than the batch has, counting the other days", () => {
    // 1 000 placed − 10 dead on arrival = 990 started
    expect(batch.checkDay(today, { ...EMPTY_DAY, dead: 5, culled: 0 }, 985, today).ok).toBe(true);
    expect(batch.checkDay(today, { ...EMPTY_DAY, dead: 5, culled: 1 }, 985, today)).toEqual({ ok: false, error: "MORE_DEAD_THAN_ON_HAND" });
  });

  it("refuses negative counts and an empty feed quantity", () => {
    expect(batch.checkDay(today, { ...entry, dead: -1 }, 0, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(batch.checkDay(today, { ...entry, waterMl: 1.5 }, 0, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(batch.checkDay(today, { ...entry, feed: { ...feed, grams: 0 } }, 0, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
  });
});

describe("Batch.checkWeighing (SPEC B3)", () => {
  const today = day("2026-11-06");
  it("takes a sample on an open batch's day, and refuses a bad sample", () => {
    expect(batch.checkWeighing(today, { weightsGrams: [2000, 2100] }, today).ok).toBe(true);
    expect(batch.checkWeighing(day("2026-10-13"), { weightsGrams: [2000] }, today)).toEqual({ ok: false, error: "DAY_BEFORE_PLACEMENT" });
    expect(Batch.rehydrate(placement, "closed").checkWeighing(today, { weightsGrams: [2000] }, today)).toEqual({ ok: false, error: "BATCH_CLOSED" });
    expect(batch.checkWeighing(today, { totalGrams: 0, count: 3 }, today)).toEqual({ ok: false, error: "INVALID_SAMPLE" });
  });
});
