import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { layerKpis } from "./kpi";

// A hand-computed week: 100 hens housed at 20 weeks, two days of entries and three collections.
const counts = (normal: number, more: Partial<{ cracked: number; dirty: number; broken: number }> = {}) => ({ normal, cracked: 0, dirty: 0, doubleYolk: 0, floor: 0, broken: 0, ...more });
const k = layerKpis(
  { placedOn: "2026-11-01" as FarmDay, ageAtPlacementDays: 140, hensHoused: 100 },
  [
    { day: "2026-11-01", dead: 1, culled: 0, feed: { grams: 11_000 }, waterMl: 22_000 },
    { day: "2026-11-02", dead: 0, culled: 1, feed: { grams: 11_000 }, waterMl: 20_000 },
  ],
  [],
  [
    { day: "2026-11-01", counts: counts(80, { cracked: 2 }), sample: { count: 10, grams: 600 } },
    { day: "2026-11-02", counts: counts(85, { dirty: 3, broken: 1 }), sample: null },
    { day: "2026-11-02", counts: counts(5), sample: null },
  ],
  "2026-11-02" as FarmDay,
);

describe("layer KPIs (SPEC-m3 E5)", () => {
  it("matches the hand calculation", () => {
    expect(k.hensOnHand).toBe(98); // 100 − 1 dead − 1 culled
    expect(k.mortalityPercent).toBe(2);
    expect(k.lastDay?.eggs).toBe(94); // 85 + 3 + 1 + 5
    expect(k.lastDay?.layingRate).toBeCloseTo(94.95, 2); // 94 eggs ÷ 99 hens on hand that morning
    expect(k.eggsPerHenHoused).toBe(1.76); // 176 ÷ 100
    expect(k.eggWeightGrams).toBe(60); // 600 g ÷ 10 eggs
    expect(k.feedPerEggGrams).toBe(125); // 22 000 g ÷ 176
    expect(k.downgradedPercent).toBeCloseTo(3.41, 2); // (2 + 3 + 1) ÷ 176
  });

  it("gives week rows by the birds' age, rate over hen-days", () => {
    expect(k.weeks).toHaveLength(1);
    const w = k.weeks[0];
    expect(w).toMatchObject({ week: 20, hens: 98, eggWeightGrams: 60 });
    expect(w.layingRate).toBeCloseTo(88.44, 2); // 176 ÷ (100 + 99)
    expect(w.feedPerHenGrams).toBeCloseTo(110.55, 2); // 22 000 ÷ 199
    expect(w.waterPerFeed).toBeCloseTo(1.909, 3); // 42 000 ml ÷ 22 000 g
  });

  it("has nothing to divide before the first record", () => {
    const empty = layerKpis({ placedOn: "2026-11-01" as FarmDay, hensHoused: 100 }, [], [], [], "2026-11-01" as FarmDay);
    expect(empty).toMatchObject({ hensOnHand: 100, lastDay: null, eggsPerHenHoused: 0, eggWeightGrams: null, feedPerEggGrams: null, downgradedPercent: null, weeks: [] });
  });
});
