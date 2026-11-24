import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { houseFigure, houseWeight, layingVersusStandard } from "./house-figures";
import { batchKpis } from "./kpi";

// 1 000 birds placed on 1 Oct; 10 dead and 100 kg of feed on 3 Oct; a group of 10 birds weighed 10 kg on 4 Oct.
const base = { placedOn: "2026-10-01" as FarmDay, birdsStarted: 1000, dayOldWeightGrams: null };
const entries = [{ day: "2026-10-03", dead: 10, culled: 0, feed: { grams: 100_000 } }];
const group = { id: "w1", day: "2026-10-04", count: 10, totalGrams: 10_000, weightsGrams: [] as number[] };
const today = "2026-10-05" as FarmDay;

describe("houseFigure (SPEC-m3 D1, B9)", () => {
  it("broilers and turkeys: batchKpis' cumulative FCR at the latest weighing", () => {
    // 990 birds × 1 000 g = 990 kg live; 100 kg of feed / 990 kg = 0.1010.
    for (const species of ["broiler", "turkey"] as const) {
      const f = houseFigure({ ...base, species }, entries, [group], today);
      expect(f).toEqual({ kind: "fcr", value: batchKpis(base, entries, [group], today).weighed!.fcr });
      expect(f!.value).toBeCloseTo(100 / 990, 8);
    }
  });

  it("broilers: null before a weighing or before any feed", () => {
    expect(houseFigure({ ...base, species: "broiler" }, entries, [], today)).toBeNull();
    expect(houseFigure({ ...base, species: "broiler" }, [], [group], today)).toBeNull();
  });

  it("pullets: the uniformity of the latest weighing", () => {
    // Mean 1 000 g; 880 g is outside 900–1 100 g: 5 of 6 → 83.3 %. The older weighing (all within) is ignored.
    const old = { id: "w1", day: "2026-10-02", count: 2, totalGrams: 2000, weightsGrams: [1000, 1000] };
    const last = { id: "w2", day: "2026-10-04", count: 6, totalGrams: 6000, weightsGrams: [950, 1000, 1050, 1100, 880, 1020] };
    expect(houseFigure({ ...base, species: "pullet" }, entries, [last, old], today)).toEqual({ kind: "uniformity", value: 83.3 });
    // Same day: the later id (UUIDv7) wins, as in batchKpis.
    expect(houseFigure({ ...base, species: "pullet" }, entries, [{ ...old, day: last.day, id: "w3" }, last], today)).toEqual({ kind: "uniformity", value: 100 });
  });

  it("pullets: null when the latest weighing was a group one", () => {
    const old = { id: "w0", day: "2026-10-02", count: 2, totalGrams: 2000, weightsGrams: [1000, 1000] };
    expect(houseFigure({ ...base, species: "pullet" }, entries, [old, group], today)).toBeNull();
  });

  it("other types show no figure", () => {
    const w = [{ ...group, weightsGrams: [1000, 1000] }];
    for (const species of ["layer", "beldi"] as const) expect(houseFigure({ ...base, species }, entries, w, today)).toBeNull();
  });
});

// Synthetic curves (SPEC-m3 §4: never real breeder values in code or tests' names).
const point = (day: number, bodyWeightGrams: number) => ({ day, bodyWeightGrams, cumulativeFeedGrams: 0 });
const mixed = { sex: "mixed" as const, points: [point(0, 40), point(7, 180)] };
const female = { sex: "female" as const, points: [point(0, 40), point(7, 200)] };

describe("houseWeight (SPEC-m3 D1)", () => {
  it("the latest weighing's average and its gap to the standard at the birds' age, from the batch's sex curve", () => {
    // Weighed on 4 Oct, placed 1 Oct: day 3. Mixed standard at day 3: 40 + 140 × 3/7 = 100 g; 1 000 g is +900 %.
    const broiler = { ...base, species: "broiler" as const };
    expect(houseWeight(broiler, [group], [mixed])).toEqual({ averageGrams: 1000, standard: { grams: 100, gapPercent: 900 } });
    // A female turkey lot compares with the female curve (R6): 40 + 160 × 3/7 = 108.6 → 109 g.
    expect(houseWeight({ ...base, species: "turkey", sex: "female" }, [group], [mixed, female])!.standard!.grams).toBe(109);
    // Pullets placed at 2 days old: day 5 → 140 g. A later weighing of the same day wins (as batchKpis).
    const later = { ...group, id: "w2", totalGrams: 14_000 };
    expect(houseWeight({ ...base, species: "pullet", ageAtPlacementDays: 2 }, [later, group], [mixed])).toEqual({ averageGrams: 1400, standard: { grams: 140, gapPercent: 900 } });
  });

  it("the weight alone without a curve, or when the curve does not reach that age (never extrapolated)", () => {
    const broiler = { ...base, species: "broiler" as const };
    expect(houseWeight(broiler, [group], [])).toEqual({ averageGrams: 1000, standard: null });
    expect(houseWeight({ ...broiler, ageAtPlacementDays: 10 }, [group], [mixed])).toEqual({ averageGrams: 1000, standard: null });
  });

  it("null before a weighing and for the other types", () => {
    expect(houseWeight({ ...base, species: "broiler" }, [], [mixed])).toBeNull();
    for (const species of ["layer", "beldi"] as const) expect(houseWeight({ ...base, species }, [group], [mixed])).toBeNull();
  });
});

describe("layingVersusStandard (SPEC-m3 D1, E5)", () => {
  const week = (w: number, layingRatePermille: number | null) => ({ week: w, layingRatePermille, eggsPerHenHousedTenths: null, eggWeightDg: null, feedGramsPerHenDay: null, bodyWeightGrams: null });
  const old = { points: [week(20, 100), week(30, 100)] };
  const latestCurve = { points: [week(20, 500), week(30, 900)] };
  // Placed on 1 Oct at 175 days (25 weeks); 3 Oct is day 177, still week 25: 500 + 400 × 5/10 = 700 ‰ = 70 %.
  const layers = { placedOn: "2026-10-01", ageAtPlacementDays: 175 };

  it("the gap in points to the latest curve at the week of age of that day", () => {
    expect(layingVersusStandard(layers, "2026-10-03", 72.35, [old, latestCurve])).toEqual({ standardPercent: 70, gapPoints: 2.4 });
    expect(layingVersusStandard(layers, "2026-10-08", 60, [latestCurve])).toEqual({ standardPercent: 74, gapPoints: -14 }); // day 182: week 26
  });

  it("null without a curve, outside it, or without a rate for that week", () => {
    expect(layingVersusStandard(layers, "2026-10-03", 70, [])).toBeNull();
    expect(layingVersusStandard({ ...layers, ageAtPlacementDays: 300 }, "2026-10-03", 70, [latestCurve])).toBeNull(); // week 43
    expect(layingVersusStandard(layers, "2026-10-03", 70, [{ points: [week(20, null), week(30, 900)] }])).toBeNull();
  });
});
