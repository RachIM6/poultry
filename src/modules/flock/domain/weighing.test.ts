import { describe, expect, it } from "vitest";
import { checkSample, sampleStats, versusStandard } from "./weighing";

describe("weighing (SPEC B3)", () => {
  it("matches the hand calculation: average and CV% of individual weights", () => {
    // By hand: 2 000, 2 100, 1 900, 2 200, 1 800 g → mean 2 000 g.
    // Deviations 0, 100, −100, 200, −200 → squares 0 + 10 000 + 10 000 + 40 000 + 40 000 = 100 000.
    // Sample variance 100 000 / (5 − 1) = 25 000 → SD 158,11 g → CV = 158,11 / 2 000 = 7,9 %.
    expect(sampleStats({ weightsGrams: [2000, 2100, 1900, 2200, 1800] })).toEqual({ count: 5, averageGrams: 2000, cvPercent: 7.9 });
  });

  it("gives the average of a weighed group, without CV", () => {
    expect(sampleStats({ totalGrams: 102_500, count: 50 })).toEqual({ count: 50, averageGrams: 2050, cvPercent: null });
    expect(sampleStats({ weightsGrams: [1950] })).toEqual({ count: 1, averageGrams: 1950, cvPercent: null }); // one bird: no spread
  });

  it("rounds the average to the gram", () => {
    expect(sampleStats({ weightsGrams: [1000, 1001, 1001] }).averageGrams).toBe(1001); // 1 000,67
  });

  it("compares with the standard in %, one decimal", () => {
    expect(versusStandard(2000, 2105)).toBe(-5); // −4,99 %
    expect(versusStandard(2170, 2105)).toBe(3.1);
    expect(versusStandard(2105, 2105)).toBe(0);
  });

  it("refuses empty or impossible samples", () => {
    for (const bad of [{ weightsGrams: [] }, { weightsGrams: [2000, 0] }, { weightsGrams: [25_000] }, { weightsGrams: [2000.5] }, { totalGrams: 0, count: 5 }, { totalGrams: 10_000, count: 0 }, { totalGrams: 500_000, count: 10 }]) {
      expect(checkSample(bad), JSON.stringify(bad)).toEqual({ ok: false, error: "INVALID_SAMPLE" });
    }
    expect(checkSample({ weightsGrams: Array(1000).fill(2000) }).ok).toBe(true);
    expect(checkSample({ weightsGrams: Array(1001).fill(2000) }).ok).toBe(false);
  });
});
