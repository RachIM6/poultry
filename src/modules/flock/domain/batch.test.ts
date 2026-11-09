import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { Batch, type Placement } from "./batch";

const day = (d: string) => d as FarmDay;
const placement: Placement = {
  id: "b1",
  farmId: "f1",
  houseId: "h1",
  strainId: "ross-308",
  placedOn: day("2026-10-14"),
  chicksPlaced: 12_000,
  deadOnArrival: 36,
  hatchery: "Couvoir Atlas",
  deliveryNote: "BL-2026-0412",
  chickUnitPriceCentimes: 450n,
  dayOldWeightGrams: 42,
};

describe("Batch placement (SPEC B1)", () => {
  it("counts age in farm days from the placement day, which is day 0", () => {
    const batch = Batch.place(placement, day("2026-11-21"));
    if (!batch.ok) throw new Error(batch.error);
    expect(batch.value.ageOn(day("2026-10-14"))).toBe(0);
    expect(batch.value.ageOn(day("2026-10-15"))).toBe(1);
    expect(batch.value.ageOn(day("2026-11-21"))).toBe(38);
    expect(batch.value.ageOn(day("2027-01-02"))).toBe(80); // across a month and a year end
  });

  it("is open, starts with the chicks placed minus those dead on arrival, and can only be closed", () => {
    const batch = Batch.place(placement, day("2026-10-14"));
    if (!batch.ok) throw new Error(batch.error);
    expect(batch.value.status).toBe("open");
    expect(batch.value.birdsStarted).toBe(11_964);
    expect([batch.value.canBecome("closed"), Batch.rehydrate(placement, "closed").canBecome("open")]).toEqual([true, false]);
  });

  it("refuses impossible placements", () => {
    const today = day("2026-10-20");
    expect(Batch.place({ ...placement, chicksPlaced: 0 }, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(Batch.place({ ...placement, deadOnArrival: -1 }, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(Batch.place({ ...placement, deadOnArrival: 12_000 }, today)).toEqual({ ok: false, error: "DEAD_ON_ARRIVAL_TOO_HIGH" });
    expect(Batch.place({ ...placement, dayOldWeightGrams: 0 }, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(Batch.place({ ...placement, placedOn: day("2026-10-21") }, today)).toEqual({ ok: false, error: "PLACEMENT_IN_FUTURE" });
    expect(Batch.place({ ...placement, dayOldWeightGrams: null, chickUnitPriceCentimes: 0n }, today).ok).toBe(true);
  });
});

describe("Birds sold (SPEC B5)", () => {
  const batch = Batch.rehydrate(placement, "open"); // 11 964 started
  const today = day("2026-11-21");

  it("lets birds leave alive while some are on hand, between placement and today", () => {
    expect(batch.checkBirdsSold(today, 2000, 9_000, today).ok).toBe(true);
    expect(batch.checkBirdsSold(today, 2964, 9_000, today).ok).toBe(true); // the last ones
    expect(batch.checkBirdsSold(today, 2965, 9_000, today)).toEqual({ ok: false, error: "MORE_BIRDS_THAN_ON_HAND" });
    expect(batch.checkBirdsSold(today, 0, 0, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(batch.checkBirdsSold(day("2026-10-13"), 1, 0, today)).toEqual({ ok: false, error: "DAY_BEFORE_PLACEMENT" });
    expect(batch.checkBirdsSold(day("2026-11-22"), 1, 0, today)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(Batch.rehydrate(placement, "closed").checkBirdsSold(today, 1, 0, today)).toEqual({ ok: false, error: "BATCH_CLOSED" });
  });

  it("counts birds sold against a day's dead and culled", () => {
    const entry = { dead: 10, deathCause: "heat" as const, culled: 0, feed: null, waterMl: null, note: null };
    expect(batch.checkDay(today, entry, 11_954, today).ok).toBe(true); // 11 954 out elsewhere (dead + sold) + 10
    expect(batch.checkDay(today, entry, 11_955, today)).toEqual({ ok: false, error: "MORE_DEAD_THAN_ON_HAND" });
  });
});

describe("Closing (SPEC B6)", () => {
  const today = day("2026-11-21");

  it("closes an open batch once, on a day between placement and today", () => {
    const batch = Batch.rehydrate(placement, "open");
    expect(batch.close(day("2026-11-22"), today)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(batch.close(day("2026-10-13"), today)).toEqual({ ok: false, error: "DAY_BEFORE_PLACEMENT" });
    expect(batch.close(today, today).ok).toBe(true);
    expect(batch.status).toBe("closed");
    expect(batch.close(today, today)).toEqual({ ok: false, error: "BATCH_CLOSED" });
    expect(batch.checkBirdsSold(today, 1, 0, today)).toEqual({ ok: false, error: "BATCH_CLOSED" }); // read-only now
  });
});

