import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { Batch, ageOfBatch, birdsPlaced, birdsStarted, canJoinHouse, doaClaim, type Placement } from "./batch";

const day = (d: string) => d as FarmDay;
const placement: Placement = {
  id: "b1",
  farmId: "f1",
  houseId: "h1",
  species: "broiler",
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
    expect(batch.checkBirdsSold(today, 2000, 2964, today).ok).toBe(true); // 9 000 already out
    expect(batch.checkBirdsSold(today, 2964, 2964, today).ok).toBe(true); // the last ones
    expect(batch.checkBirdsSold(today, 2965, 2964, today)).toEqual({ ok: false, error: "MORE_BIRDS_THAN_ON_HAND" });
    expect(batch.checkBirdsSold(today, 0, 11_964, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(batch.checkBirdsSold(day("2026-10-13"), 1, 11_964, today)).toEqual({ ok: false, error: "DAY_BEFORE_PLACEMENT" });
    expect(batch.checkBirdsSold(day("2026-11-22"), 1, 11_964, today)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(Batch.rehydrate(placement, "closed").checkBirdsSold(today, 1, 11_964, today)).toEqual({ ok: false, error: "BATCH_CLOSED" });
  });

  it("counts birds sold against a day's dead and culled", () => {
    const entry = { dead: 10, deathCause: "heat" as const, culled: 0, feed: null, waterMl: null, note: null };
    expect(batch.checkDay(today, entry, 10, today).ok).toBe(true); // 11 954 out elsewhere (dead + sold): 10 on hand
    expect(batch.checkDay(today, entry, 9, today)).toEqual({ ok: false, error: "MORE_DEAD_THAN_ON_HAND" });
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
    expect(batch.checkBirdsSold(today, 1, 11_964, today)).toEqual({ ok: false, error: "BATCH_CLOSED" }); // read-only now
  });
});


describe("every production type (SPEC-m3 B7, B8)", () => {
  it("counts the birds' age from the age they arrived at", () => {
    const hens = Batch.rehydrate({ ...placement, species: "layer", ageAtPlacementDays: 126 }, "open");
    expect(hens.ageOn(day("2026-10-21"))).toBe(133); // 18 weeks + 7 days
    expect(ageOfBatch({ placedOn: "2026-10-14" }, day("2026-10-21"))).toBe(7); // a batch pulled before M3
    expect(Batch.place({ ...placement, ageAtPlacementDays: -1 }, day("2026-10-14"))).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(Batch.place({ ...placement, ageAtPlacementDays: 601 }, day("2026-10-14"))).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(Batch.place({ ...placement, ageAtPlacementDays: 126 }, day("2026-10-14")).ok).toBe(true);
  });

  it("keeps one open batch per house, except beldi bands sharing a run", () => {
    expect(canJoinHouse("broiler", []).ok).toBe(true);
    expect(canJoinHouse("broiler", [{ species: "broiler" }])).toEqual({ ok: false, error: "HOUSE_HAS_OPEN_BATCH" });
    expect(canJoinHouse("beldi", [{ species: "beldi" }, { species: "beldi" }]).ok).toBe(true);
    expect(canJoinHouse("beldi", [{ species: "layer" }]).ok).toBe(false);
    expect(canJoinHouse("layer", [{ species: "beldi" }]).ok).toBe(false);
  });

  it("lets a turkey batch of one sex join the other sex's, nothing more (SPEC-m3 B9)", () => {
    expect(canJoinHouse("turkey", [{ species: "turkey", sex: "female" }], "male").ok).toBe(true);
    expect(canJoinHouse("turkey", [{ species: "turkey", sex: "female" }], "female").ok).toBe(false);
    expect(canJoinHouse("turkey", [{ species: "turkey", sex: "female" }, { species: "turkey", sex: "male" }], "male").ok).toBe(false);
    expect(canJoinHouse("turkey", [{ species: "turkey" }], "male").ok).toBe(false); // a mixed batch is already there
    expect(canJoinHouse("turkey", [{ species: "turkey", sex: "female" }]).ok).toBe(false);
    expect(Batch.place({ ...placement, sex: "male" }, day("2026-10-14"))).toEqual({ ok: false, error: "INVALID_INPUT" }); // broilers aren't sexed
    expect(Batch.place({ ...placement, species: "turkey", sex: "male" }, day("2026-10-14")).ok).toBe(true);
  });
});

describe("chick arrival (SPEC-m3 B10)", () => {
  // P-ChickArrival's example: 10 000 billed + 200 free, 14 dead on arrival.
  const delivery = { ...placement, chicksPlaced: 10_000, freeChicks: 200, deadOnArrival: 14 };

  it("places the billed chicks plus the free supplement", () => {
    expect(birdsPlaced(delivery)).toBe(10_200);
    expect(birdsPlaced({ chicksPlaced: 1000 })).toBe(1000); // a batch pulled before M3
  });

  it("starts with the billed chicks plus the free supplement, less the dead on arrival", () => {
    expect(birdsStarted(delivery)).toBe(10_186);
    expect(Batch.rehydrate(delivery, "open").birdsStarted).toBe(10_186);
    expect(birdsStarted({ chicksPlaced: 1000, deadOnArrival: 10 })).toBe(990); // a batch pulled before M3
    expect(Batch.place({ ...delivery, deadOnArrival: 10_199 }, day("2026-10-14")).ok).toBe(true);
    expect(Batch.place({ ...delivery, deadOnArrival: 10_200 }, day("2026-10-14"))).toEqual({ ok: false, error: "DEAD_ON_ARRIVAL_TOO_HIGH" });
    expect(Batch.place({ ...delivery, freeChicks: -1 }, day("2026-10-14"))).toEqual({ ok: false, error: "INVALID_QUANTITY" });
  });

  it("flags a claim only above a threshold the farm set", () => {
    expect(doaClaim(delivery, null)).toBe(false); // no threshold assumed (MQ6)
    expect(doaClaim(delivery, 5)).toBe(false); // 14 of 10 200 = 1.37 ‰
    expect(doaClaim(delivery, 1)).toBe(true);
    expect(doaClaim({ ...delivery, deadOnArrival: 51 }, 5)).toBe(false); // 51 of 10 200 = 5.0 ‰: at the threshold, not above
    expect(doaClaim({ ...delivery, deadOnArrival: 52 }, 5)).toBe(true);
  });
});

describe("transfer to laying (SPEC-m3 B13)", () => {
  const pullets = Batch.rehydrate({ ...placement, species: "pullet", ageAtPlacementDays: 0 }, "open");
  const today = day("2027-02-10");

  it("moves some or all of the pullets on hand, from a pullet batch only", () => {
    expect(pullets.checkTransfer(today, 4780, 4780, today).ok).toBe(true);
    expect(pullets.checkTransfer(today, 4700, 4780, today).ok).toBe(true); // 80 left behind, culled by the use case
    expect(pullets.checkTransfer(today, 4781, 4780, today)).toEqual({ ok: false, error: "MORE_BIRDS_THAN_ON_HAND" });
    expect(pullets.checkTransfer(today, 0, 4780, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(Batch.rehydrate(placement, "open").checkTransfer(today, 10, 4780, today)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(Batch.rehydrate({ ...placement, species: "pullet" }, "closed").checkTransfer(today, 10, 4780, today)).toEqual({ ok: false, error: "BATCH_CLOSED" });
  });
});
