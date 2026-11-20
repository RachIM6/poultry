import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getReferenceData } from "@/modules/reference-data";
import { curveFor, layingStandardAt } from "@/modules/reference-data/shared";

// SPEC-m3 R6, R7: what the phone receives. Made-up values, only to test the plumbing: real curves come from the
// breeders' documents (MQ1), never from the seed of this test.
describe("growth curves by sex and laying curves (SPEC-m3 R6, R7)", () => {
  it("serves each sex's growth curve and the laying curve of a strain", async () => {
    await db.strain.create({
      data: {
        id: "test-turkey",
        name: "Test turkey",
        productionTypes: ["turkey"],
        curves: {
          create: [
            { source: "Test", version: "1", sex: "female", points: { create: [{ day: 0, bodyWeightGrams: 50, cumulativeFeedGrams: 0 }, { day: 7, bodyWeightGrams: 150, cumulativeFeedGrams: 120 }] } },
            { source: "Test", version: "1", sex: "male", points: { create: [{ day: 0, bodyWeightGrams: 55, cumulativeFeedGrams: 0 }, { day: 7, bodyWeightGrams: 170, cumulativeFeedGrams: 130 }] } },
          ],
        },
        layingCurves: {
          create: {
            source: "Test",
            version: "1",
            points: {
              create: [
                { week: 20, layingRatePermille: 100, eggsPerHenHousedTenths: 7, eggWeightDg: 450, feedGramsPerHenDay: 90, bodyWeightGrams: null },
                { week: 22, layingRatePermille: 500, eggsPerHenHousedTenths: 35, eggWeightDg: 500, feedGramsPerHenDay: 100, bodyWeightGrams: null },
              ],
            },
          },
        },
      },
    });

    const strain = (await getReferenceData()).strains.find((s) => s.id === "test-turkey")!;
    expect(strain.productionTypes).toEqual(["turkey"]);
    expect(curveFor(strain.curves, "male")?.points[1].bodyWeightGrams).toBe(170);
    expect(curveFor(strain.curves, "female")?.points[1].bodyWeightGrams).toBe(150);
    expect(layingStandardAt(strain.layingCurves[0].points, 21)).toEqual({
      layingRatePermille: 300,
      eggsPerHenHousedTenths: 21,
      eggWeightDg: 475,
      feedGramsPerHenDay: 95,
      bodyWeightGrams: null,
    });
  });
});
