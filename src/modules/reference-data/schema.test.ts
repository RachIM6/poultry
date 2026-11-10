import { describe, expect, it } from "vitest";
import { CurveFile, standardAt, type CurvePoint } from "./schema";

// A made-up weekly table, only to test the lookup. Real curves come from the breeders' documents (OQ5).
const weekly: CurvePoint[] = [
  { day: 0, bodyWeightGrams: 40, cumulativeFeedGrams: 0 },
  { day: 7, bodyWeightGrams: 180, cumulativeFeedGrams: 150 },
  { day: 14, bodyWeightGrams: 480, cumulativeFeedGrams: 560 },
];

describe("standardAt (SPEC R1)", () => {
  it("returns a published day as is", () => {
    expect(standardAt(weekly, 7)).toEqual({ bodyWeightGrams: 180, cumulativeFeedGrams: 150 });
    expect(standardAt(weekly, 0)).toEqual({ bodyWeightGrams: 40, cumulativeFeedGrams: 0 });
    expect(standardAt(weekly, 14)).toEqual({ bodyWeightGrams: 480, cumulativeFeedGrams: 560 });
  });

  it("interpolates linearly between published days, to the gram", () => {
    expect(standardAt(weekly, 10)).toEqual({ bodyWeightGrams: 309, cumulativeFeedGrams: 326 }); // 180 + 300·3/7, 150 + 410·3/7
    expect(standardAt(weekly, 3.5)).toEqual({ bodyWeightGrams: 110, cumulativeFeedGrams: 75 });
  });

  it("never extrapolates outside the table", () => {
    expect(standardAt(weekly, 15)).toBeNull();
    expect(standardAt(weekly.slice(1), 2)).toBeNull();
    expect(standardAt([], 3)).toBeNull();
  });
});

describe("CurveFile", () => {
  const file = { strainId: "ross-308", source: "Ross 308 Broiler Performance Objectives, Aviagen", version: "2022", points: weekly };

  it("accepts a table whose days increase", () => {
    expect(CurveFile.safeParse(file).success).toBe(true);
  });

  it("rejects unordered or repeated days, fractional grams and a missing source", () => {
    expect(CurveFile.safeParse({ ...file, points: [weekly[1], weekly[0]] }).success).toBe(false);
    expect(CurveFile.safeParse({ ...file, points: [weekly[0], weekly[0]] }).success).toBe(false);
    expect(CurveFile.safeParse({ ...file, points: [weekly[0], { ...weekly[1], bodyWeightGrams: 180.5 }] }).success).toBe(false);
    expect(CurveFile.safeParse({ ...file, source: "" }).success).toBe(false);
  });
});
