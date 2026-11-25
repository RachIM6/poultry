import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { depreciationShares, depreciationToDay, PRODUCTION_EXPENSE_CATEGORIES } from "@/modules/finance/domain/production-cost";
import { batchInProgressValue, batchesAtClose } from "@/modules/finance/domain/stocks";

const day = (d: string) => d as FarmDay;
const year = { from: day("2025-01-01"), to: day("2025-12-31") };
const houses = [
  { id: "B1", farmId: "F", areaM2: 1000 },
  { id: "B2", farmId: "F", areaM2: 1000 },
  { id: "B3", farmId: "F", areaM2: 1000 },
  { id: "X1", farmId: "G", areaM2: 500 },
];
const asset = (a: Partial<Parameters<typeof depreciationShares>[0][number]>) => ({
  category: "equipment" as const,
  farmId: "F",
  houseId: null,
  cost: 0n,
  residual: 0n,
  lifeMonths: 12,
  inServiceOn: day("2025-01-01"),
  disposedOn: null,
  opening: null,
  ...a,
});
// §7.1 F: the house B1, in the opening balance with 150 000,00 depreciated of 600 000,00 over 240 months (charge 2025:
// 30 000,00); the generator of §7.1 A put into service on 18 Sep 2025 on the farm (2 254,76 over Sep–Dec); an office
// computer (administration, never in a production cost).
const building = asset({ category: "building", houseId: "B1", cost: 60_000_000n, lifeMonths: 240, inServiceOn: day("2020-01-01"), opening: { on: day("2025-01-01"), accumulated: 15_000_000n } });
const generator = asset({ cost: 4_735_000n, lifeMonths: 84, inServiceOn: day("2025-09-18") });
const computer = asset({ category: "computer", cost: 900_000n, lifeMonths: 36, inServiceOn: day("2025-01-10") });
const broiler = { id: "c", houseId: "B1", placedOn: "2025-11-01" };

describe("the production cost of a batch in progress (SPEC-finance FC4, FQ19: PCA pp. 42–43)", () => {
  it("§7.1 F: the house's 30 000,00 × 61 ÷ 365 days + the generator's 2 254,76 × 1 000 m² × 61 ÷ (3 000 m² × 122) = 5 389,49; the computer adds nothing", () => {
    expect(depreciationShares([building], houses, [broiler], year, 1)).toEqual(new Map([["c", 501_370n]])); // 501 369,86 centimes
    expect(depreciationShares([generator], houses, [broiler], year, 1)).toEqual(new Map([["c", 37_579n]])); // 37 579,33
    expect(depreciationShares([building, generator, computer], houses, [broiler], year, 1)).toEqual(new Map([["c", 538_949n]]));
  });

  it("§7.1 F: 182 400,00 direct + 5 389,49 depreciation + 600,00 indirect = 188 389,49 engaged; 149 141,68 at cost; provision 13 481,68", () => {
    const sale = { kind: "live" as const, pricePerKgCentimes: 850n, amountCentimes: 0n, birds: 0 };
    const c = { id: "c", farmId: "F", houseName: "B1", species: "broiler", onHand: 7600, sold: 2000, costs: { direct: 18_240_000n, depreciation: 538_949n, indirect: 60_000n } };
    const [line] = batchesAtClose([c], new Map([["c", { count: 50, totalGrams: 105_000 }]]), new Map([["F:broiler", sale]]), new Map());
    expect(line).toMatchObject({ engaged: 18_838_949n, cost: 14_914_168n, current: 13_566_000n, provision: 1_348_168n }); // 14 914 167,96 centimes
    expect(batchInProgressValue(18_838_949n, 7600, 2000, 13_566_000n)).toEqual({ cost: 14_914_168n, provision: 1_348_168n });
  });

  it("shares a house's charge by days in it, a farm's by m² × days; empty days and other farms take nothing here", () => {
    const year1 = asset({ houseId: "B2", cost: 365_000n, lifeMonths: 12 }); // 3 650,00 in 2025: 10,00 a day
    const two = [
      { id: "a", houseId: "B2", placedOn: "2025-12-02" }, // 30 days
      { id: "b", houseId: "B1", placedOn: "2025-01-01" }, // another house
    ];
    expect(depreciationShares([year1], houses, two, year, 1)).toEqual(new Map([["a", 30_000n]]));
    expect(depreciationShares([year1], houses, [{ ...two[0], until: "2025-12-11" }], year, 1)).toEqual(new Map([["a", 10_000n]])); // a laying flock gone on the 11th: 10 days (FQ18)
    // On the farm: 1 000 of its 3 000 m²; X1 is on another farm.
    const farm = asset({ cost: 365_000n, lifeMonths: 12 });
    expect(depreciationShares([farm], houses, [...two, { id: "x", houseId: "X1", placedOn: "2025-01-01" }], year, 1)).toEqual(new Map([["a", 10_000n], ["b", 121_667n]]));
    // No place, land, a year with no charge, a disposal: the months depreciated bound the days.
    expect(depreciationShares([asset({ farmId: null, cost: 365_000n })], houses, two, year, 1)).toEqual(new Map());
    expect(depreciationShares([asset({ category: "land", houseId: "B2", lifeMonths: null, cost: 365_000n })], houses, two, year, 1)).toEqual(new Map());
    expect(depreciationShares([asset({ houseId: "B2", cost: 365_000n, inServiceOn: day("2024-01-01") })], houses, two, year, 1)).toEqual(new Map()); // life over
    const disposed = asset({ houseId: "B1", cost: 1_200_000n, lifeMonths: 12, disposedOn: day("2025-07-15") }); // Jan–Jun: 6 000,00 over 181 days
    expect(depreciationShares([disposed], houses, [{ id: "b", houseId: "B1", placedOn: "2025-06-01" }], year, 1)).toEqual(new Map([["b", 99_448n]])); // 600 000 × 30 ÷ 181
  });

  it("counts the production expense categories only (p. 43: no distribution, no administration)", () => {
    expect(PRODUCTION_EXPENSE_CATEGORIES).toEqual(["electricity", "water", "vet_fees", "insurance"]);
  });
});

describe("the pullets' share of depreciation capitalised on 23962 (SPEC-finance FC6 classic, FQ19: PCA p. 34)", () => {
  // §7.1 G: the rearing house P1, 120 000,00 over 120 months from January 2025 (12 000,00 a year, 365 days); 1 000
  // pullets placed in it on 1 October 2025.
  const p1 = [{ id: "P1", farmId: "F", areaM2: 1000 }, { id: "L1", farmId: "F", areaM2: 1000 }];
  const rearing = asset({ category: "building", houseId: "P1", cost: 12_000_000n, lifeMonths: 120 });
  const pullets = { id: "p", houseId: "P1", placedOn: "2025-10-01" };

  it("§7.1 G: 92 days of 2025 at the close; 60 more of 2026 at the transfer on 1 March; 365 more at the 2026 close", () => {
    expect(depreciationToDay([rearing], p1, pullets, day("2025-12-31"), 1)).toBe(302_466n); // 1 200 000 × 92 ÷ 365 = 302 465,75
    expect(depreciationToDay([rearing], p1, pullets, day("2026-03-01"), 1)).toBe(302_466n + 197_260n); // × 60 ÷ 365 = 197 260,27
    expect(depreciationToDay([rearing], p1, pullets, day("2026-12-31"), 1)).toBe(302_466n + 1_200_000n);
    // the same as each year's share alone: the 2026 close capitalises 12 000,00, the cumulative less the 2025 part
    expect(depreciationShares([rearing], p1, [pullets], { from: day("2026-01-01"), to: day("2026-12-31") }, 1)).toEqual(new Map([["p", 1_200_000n]]));
  });

  it("`until` bounds the days of the year; a day before the placement counts none", () => {
    expect(depreciationShares([rearing], p1, [{ ...pullets, until: "2025-10-31" }], year, 1)).toEqual(new Map([["p", 101_918n]])); // × 31 ÷ 365 = 101 917,81
    expect(depreciationShares([rearing], p1, [{ ...pullets, until: "2025-09-30" }], year, 1)).toEqual(new Map());
    expect(depreciationToDay([rearing], p1, pullets, day("2025-09-30"), 1)).toBe(0n);
  });

  it("follows a fiscal year starting in July", () => {
    // 2025-07 → 2026-06: 12 000,00 over 365 days; the pullets' 1 Oct – 31 Dec 2025 then 1 Jan – 1 Mar 2026: 152 days.
    expect(depreciationToDay([rearing], p1, pullets, day("2026-03-01"), 7)).toBe(499_726n); // 1 200 000 × 152 ÷ 365 = 499 726,03
  });
});
