import { describe, expect, it } from "vitest";
import { nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { batchKpis, epef, feedConversionRatio } from "./kpi";

// Reference batch, computed by hand. 10 050 chicks placed on 1 Oct 2026, 50 dead on arrival → 10 000 started; day-old
// weight 42 g. Days 1–7: 20 dead/day, 150 kg feed/day. Days 8–21: 5 dead/day, 800 kg/day. Days 22–35: 3 dead + 2 culled
// per day, 1 500 kg/day. Weighed on days 7 (180 g), 21 (1 000 g) and 35 (2 300 g).
const placedOn = "2026-10-01" as FarmDay;
const dayAt = (age: number) => {
  let d = placedOn;
  for (let i = 0; i < age; i++) d = nextFarmDay(d);
  return d;
};
const entries = Array.from({ length: 35 }, (_, i) => {
  const age = i + 1;
  const [dead, culled, kg] = age <= 7 ? [20, 0, 150] : age <= 21 ? [5, 0, 800] : [3, 2, 1500];
  return { day: dayAt(age), dead, culled, feed: { grams: kg * 1000 } };
});
const weighing = (age: number, grams: number, id = `w${age}`) => ({ id, day: dayAt(age), count: 50, totalGrams: grams * 50 });
const batch = { placedOn, birdsStarted: 10_000, dayOldWeightGrams: 42 };
const on = (age: number) =>
  batchKpis(
    batch,
    entries.filter((e) => e.day <= dayAt(age)),
    [weighing(7, 180), weighing(21, 1000), weighing(35, 2300)].filter((w) => w.day <= dayAt(age)),
    dayAt(age),
  );

describe("batch KPIs on the reference batch (SPEC B4)", () => {
  it("day 7", () => {
    // Out 7 × 20 = 140 → 9 860 on hand, mortality 140 / 10 000 = 1.4 %. Feed 7 × 150 kg = 1 050 kg → 106.49 g/bird.
    // Live weight 9 860 × 180 g = 1 774.8 kg → FCR 1 050 / 1 774.8 = 0.5916. Livability 98.6 %:
    // EPEF = 98.6 × 0.18 / (7 × 0.5916) × 100 = 428.56. Daily gain (180 − 42) / 7 = 19.71 g.
    const k = on(7);
    expect(k).toMatchObject({ ageDays: 7, birdsOnHand: 9860 });
    expect(k.mortalityPercent).toBeCloseTo(1.4, 6);
    expect(k.feedPerBirdGrams).toBeCloseTo(106.49, 2);
    expect(k.weighed).toMatchObject({ ageDays: 7, averageGrams: 180 });
    expect(k.weighed?.fcr).toBeCloseTo(0.5916, 4);
    expect(k.weighed?.epef).toBeCloseTo(428.56, 2);
    expect(k.weighed?.dailyGainGrams).toBeCloseTo(19.71, 2);
  });

  it("day 21", () => {
    // Out 140 + 14 × 5 = 210 → 9 790, 2.1 %. Feed 1 050 + 14 × 800 = 12 250 kg → 1 251.28 g/bird.
    // Live 9 790 × 1 000 g = 9 790 kg → FCR 1.2513. EPEF = 97.9 × 1.0 / (21 × 1.2513) × 100 = 372.57. Gain 958 / 21 = 45.62 g.
    const k = on(21);
    expect(k).toMatchObject({ ageDays: 21, birdsOnHand: 9790 });
    expect(k.mortalityPercent).toBeCloseTo(2.1, 6);
    expect(k.feedPerBirdGrams).toBeCloseTo(1251.28, 2);
    expect(k.weighed?.fcr).toBeCloseTo(1.2513, 4);
    expect(k.weighed?.epef).toBeCloseTo(372.57, 2);
    expect(k.weighed?.dailyGainGrams).toBeCloseTo(45.62, 2);
  });

  it("day 35, culls counted as birds out", () => {
    // Out 210 + 14 × (3 + 2) = 280 → 9 720, 2.8 %. Feed 12 250 + 14 × 1 500 = 33 250 kg → 3 420.78 g/bird.
    // Live 9 720 × 2 300 g = 22 356 kg → FCR 1.4873. EPEF = 97.2 × 2.3 / (35 × 1.4873) × 100 = 429.47. Gain 2 258 / 35 = 64.51 g.
    const k = on(35);
    expect(k).toMatchObject({ ageDays: 35, birdsOnHand: 9720 });
    expect(k.mortalityPercent).toBeCloseTo(2.8, 6);
    expect(k.feedPerBirdGrams).toBeCloseTo(3420.78, 2);
    expect(k.weighed?.fcr).toBeCloseTo(1.4873, 4);
    expect(k.weighed?.epef).toBeCloseTo(429.47, 2);
    expect(k.weighed?.dailyGainGrams).toBeCloseTo(64.51, 2);
  });

  it("takes FCR and EPEF at the last weighing, not with today's feed", () => {
    // Day 25, last weighed on day 21: the same figures as day 21, while mortality and feed per bird move on.
    const k = batchKpis(batch, entries.filter((e) => e.day <= dayAt(25)), [weighing(7, 180), weighing(21, 1000)], dayAt(25));
    expect(k.weighed?.fcr).toBeCloseTo(1.2513, 4);
    expect(k.weighed?.ageDays).toBe(21);
    expect(k.birdsOnHand).toBe(9790 - 4 * 5);
  });

  it("uses the later of two weighings on the same day", () => {
    const k = batchKpis(batch, entries, [weighing(35, 2300, "0190a"), weighing(35, 2250, "0190b")], dayAt(35));
    expect(k.weighed?.averageGrams).toBe(2250);
  });
});

describe("batch KPIs without enough data", () => {
  it("has no weight KPIs before the first weighing", () => {
    expect(batchKpis(batch, [], [], placedOn)).toEqual({ ageDays: 0, birdsOnHand: 10_000, mortalityPercent: 0, feedPerBirdGrams: 0, weighed: null });
  });

  it("has no FCR, EPEF or gain on day 0, and gains from 0 g without a day-old weight", () => {
    const day0 = batchKpis(batch, [], [weighing(0, 42)], placedOn).weighed;
    expect(day0).toMatchObject({ fcr: null, epef: null, dailyGainGrams: null }); // nothing eaten yet, no age
    expect(batchKpis({ ...batch, dayOldWeightGrams: null }, entries, [weighing(35, 2300)], dayAt(35)).weighed?.dailyGainGrams).toBeCloseTo(65.71, 2);
  });

  it("has no feed per bird, FCR or EPEF with no bird left", () => {
    const allDead = [{ day: dayAt(3), dead: 10_000, culled: 0, feed: { grams: 5000 } }];
    const k = batchKpis(batch, allDead, [weighing(3, 80)], dayAt(3));
    expect(k).toMatchObject({ birdsOnHand: 0, mortalityPercent: 100, feedPerBirdGrams: null });
    expect(k.weighed).toMatchObject({ fcr: null, epef: null });
  });

  it("follows the formulas of SPEC §5", () => {
    const t = { placed: 100, dead: 5, feedGrams: 300_000, liveWeightGrams: 200_000, ageDays: 35, avgWeightGrams: 2105 };
    expect(feedConversionRatio(t)).toBe(1.5);
    expect(epef(t)).toBeCloseTo(((95 * 2.105) / (35 * 1.5)) * 100, 10);
    expect(epef({ ...t, placed: 0 })).toBeNull();
  });
});
