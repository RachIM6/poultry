import { describe, expect, it } from "vitest";
import { CurveFile, LayingFile, curveFor, layingStandardAt, standardAt, type CurvePoint } from "./schema";

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

describe("curveFor (SPEC-m3 R6)", () => {
  const c = (version: string, sex?: "mixed" | "female" | "male") => ({ version, sex, points: weekly });
  it("takes the latest curve of the batch's sex, else the latest mixed one", () => {
    const curves = [c("2019", "female"), c("2019"), c("2022", "female"), c("2022", "mixed")];
    expect(curveFor(curves, "female")).toBe(curves[2]);
    expect(curveFor(curves, "male")).toBe(curves[3]);
    expect(curveFor(curves, "mixed")).toBe(curves[3]);
    expect(curveFor([c("2019", "male")], "female")).toBeNull();
    expect(curveFor([], "mixed")).toBeNull();
  });
});

describe("layingStandardAt (SPEC-m3 R7)", () => {
  // Made-up weeks, only to test the lookup. Real laying tables come from the breeders' guides (MQ1).
  const p = (week: number, rate: number | null, weight: number | null) => ({
    week,
    layingRatePermille: rate,
    eggsPerHenHousedTenths: null,
    eggWeightDg: weight,
    feedGramsPerHenDay: null,
    bodyWeightGrams: null,
  });
  const table = [p(20, 100, 500), p(24, 900, 580), p(30, 940, null)];

  it("returns a published week as is, interpolates between weeks and keeps a missing column null", () => {
    expect(layingStandardAt(table, 24)).toMatchObject({ layingRatePermille: 900, eggWeightDg: 580 });
    expect(layingStandardAt(table, 22)).toMatchObject({ layingRatePermille: 500, eggWeightDg: 540, feedGramsPerHenDay: null });
    expect(layingStandardAt(table, 27)).toMatchObject({ layingRatePermille: 920, eggWeightDg: null });
    expect(layingStandardAt(table, 20 + 3 / 7)).toMatchObject({ layingRatePermille: 186 }); // day 143: 100 + 800·(3/7)/4
  });

  it("never extrapolates", () => {
    expect(layingStandardAt(table, 19)).toBeNull();
    expect(layingStandardAt(table, 31)).toBeNull();
    expect(layingStandardAt([], 25)).toBeNull();
  });

  it("validates a laying file: increasing weeks, per mille up to 1000", () => {
    const file = { strainId: "lohmann-brown", source: "Guide, publisher", version: "2024", points: table };
    expect(LayingFile.safeParse(file).success).toBe(true);
    expect(LayingFile.safeParse({ ...file, points: [table[1], table[0]] }).success).toBe(false);
    expect(LayingFile.safeParse({ ...file, points: [table[0], p(21, 1001, null)] }).success).toBe(false);
    expect(CurveFile.parse({ strainId: "but-6", source: "S", version: "1", points: weekly }).sex).toBe("mixed");
  });
});
