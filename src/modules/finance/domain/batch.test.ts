import { describe, expect, it } from "vitest";
import { allocate, batchComparison, batchResult, birdDays, keyWeight, monthPeriod, splitShared, type AllocationKey } from "@/modules/finance/domain/batch";

describe("batch result (SPEC-finance FN13, §7)", () => {
  it("B-2026-13: 315 010,00 − 270 800,00 → margin 44 210,00; 1,87 DH/kg; 14,0 %; cost 11,43 DH/kg", () => {
    expect(batchResult({ salesCentimes: 31_501_000n, costCentimes: 27_080_000n, soldGrams: 23_700_000n })).toEqual({
      marginCentimes: 4_421_000n,
      costPerKgCentimes: 1143n,
      marginPerKgCentimes: 187n,
      marginPermille: 140n,
    });
  });

  it("shows a loss rounded the same way, and no per-kg figure before anything is sold", () => {
    expect(batchResult({ salesCentimes: 100_000n, costCentimes: 150_000n, soldGrams: 30_000n })).toMatchObject({ marginCentimes: -50_000n, marginPerKgCentimes: -1667n, marginPermille: -500n });
    expect(batchResult({ salesCentimes: 0n, costCentimes: 150_000n, soldGrams: 0n })).toEqual({ marginCentimes: -150_000n, costPerKgCentimes: null, marginPerKgCentimes: null, marginPermille: null });
  });
});

describe("comparison with the last batches (FN13)", () => {
  it("gives mortality, FCR, feed price and sale price per kg", () => {
    // 10 000 started, 420 lost; 31 200 kg of feed for 4 500 000,00 DH; 18 000 kg sold for 2 700 000,00 DH
    expect(batchComparison({ started: 10_000, lost: 420, eatenGrams: 31_200_000, feedGrams: 31_200_000n, feedCentimes: 14_040_000n, soldGrams: 18_000_000n, salesCentimes: 27_000_000n })).toEqual({
      lostPermille: 42n, // 4,2 %
      fcr: 31_200 / 18_000, // 1,7333…, unrounded: the screen rounds it as every other one (formatDecimal, 2 decimals)
      feedPricePerKgCentimes: 450n, // 4,50 DH
      pricePerKgCentimes: 1500n, // 15,00 DH
    });
  });

  it("the FCR is the feed the batch ate (its daily entries), the feed price the valued consumptions", () => {
    // 1 738 kg eaten for 1 000 kg sold: 1,738, unrounded: /results shows 1,74 with formatDecimal, as the batch screen (the old ‰ display cut it to 1,73)
    const c = batchComparison({ started: 100, lost: 0, eatenGrams: 1_738_000, feedGrams: 1_700_000n, feedCentimes: 765_000n, soldGrams: 1_000_000n, salesCentimes: 0n });
    expect(c.fcr).toBe(1.738);
    expect(c.feedPricePerKgCentimes).toBe(450n); // 7 650,00 DH for the 1 700 kg valued
  });

  it("has nothing to say before anything was eaten or sold", () => {
    expect(batchComparison({ started: 0, lost: 0, eatenGrams: 0, feedGrams: 0n, feedCentimes: 0n, soldGrams: 0n, salesCentimes: 0n })).toEqual({ lostPermille: null, fcr: null, feedPricePerKgCentimes: null, pricePerKgCentimes: null });
  });
});

describe("shared-cost allocation (FN14, §7)", () => {
  it("16 500,00 by 405 000 / 337 500 bird-days → 9 000,00 / 7 500,00", () => {
    expect(allocate(1_650_000n, [{ id: "a", weight: 405_000n }, { id: "b", weight: 337_500n }])).toEqual(new Map([["a", 900_000n], ["b", 750_000n]]));
  });

  it("always sums to the total, whatever the keys (property test)", () => {
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648), seed % n);
    for (let run = 0; run < 500; run++) {
      const total = BigInt(rand(10_000_000) + 1);
      const keys = Array.from({ length: rand(6) + 1 }, (_, i) => ({ id: `k${i}`, weight: BigInt(rand(500_000)) }));
      const parts = allocate(total, keys);
      if (keys.every((k) => k.weight === 0n)) expect(parts.size).toBe(0);
      else expect([...parts.values()].reduce((s, p) => s + p, 0n)).toBe(total);
      for (const p of parts.values()) expect(p >= 0n).toBe(true);
    }
  });
});

describe("bird-days (FN14)", () => {
  it("counts the birds on hand each day of the period the batch was present", () => {
    // 1 000 birds placed 29 Oct, 10 dead on 30 Oct: October has 29, 30 (1 000 each) and 31 (990) → 2 990
    const batch = { placedOn: "2026-10-29", lastDay: null, started: 1000, out: [{ day: "2026-10-30", birds: 10 }] };
    expect(birdDays({ ...batch, ...monthPeriod("2026-10") })).toBe(2990n);
    expect(birdDays({ ...batch, ...monthPeriod("2026-09") })).toBe(0n);
    // closed on 2 Oct after selling everything on that day: 1 and 2 Oct count
    expect(birdDays({ placedOn: "2026-08-25", lastDay: "2026-10-02", started: 100, out: [{ day: "2026-10-02", birds: 100 }], ...monthPeriod("2026-10") })).toBe(200n);
    expect(monthPeriod("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });
});

describe("allocation keys (FN14, §9 decided default 2026-11-23)", () => {
  const oct = monthPeriod("2026-10");
  // A: 1 000 birds in a 1 000 m² house all October, sold 600 kg on 10 Oct and the rest in November.
  // B: 500 birds in an 800 m² house from 16 Oct, sold 100 kg on 31 Oct.
  const a = { placedOn: "2026-09-20", lastDay: null, started: 1000, out: [{ day: "2026-10-10", birds: 300 }], areaM2: 1000, soldOut: [{ day: "2026-10-10", grams: 600_000 }, { day: "2026-11-02", grams: 1_400_000 }], ...oct };
  const b = { placedOn: "2026-10-16", lastDay: null, started: 500, out: [{ day: "2026-10-31", birds: 50 }], areaM2: 800, soldOut: [{ day: "2026-10-31", grams: 100_000 }], ...oct };
  const both = [{ id: "a", facts: a }, { id: "b", facts: b }];

  it("weighs each batch by its key over the period", () => {
    expect(keyWeight("birdDays", a)).toBe(24_700n); // 1 000 × 10 days (1–10 Oct), then 700 × 21
    expect(keyWeight("houseArea", a)).toBe(31_000n); // 1 000 m² × 31 days
    expect(keyWeight("houseArea", b)).toBe(12_800n); // 800 m² × 16 days: a short batch takes less
    expect(keyWeight("houseArea", { ...b, lastDay: "2026-10-20" })).toBe(4_000n); // closed on the 20th: 5 days
    expect(keyWeight("houseArea", { ...b, ...monthPeriod("2026-09") })).toBe(0n); // not there yet
    expect(keyWeight("kgSold", a)).toBe(600_000n); // November's sale is outside the period
    expect(keyWeight("kgSold", b)).toBe(100_000n);
  });

  it("house m²: 3 900,00 by 31 000 / 12 800 m²·days → 2 760,27 / 1 139,73 (largest remainder)", () => {
    expect(splitShared(390_000n, "houseArea", both)).toEqual({ parts: new Map([["a", 276_027n], ["b", 113_973n]]), byBirdDays: false });
  });

  it("kg sold: 3 900,00 by 600 / 100 kg → 3 342,86 / 557,14 (largest remainder)", () => {
    expect(splitShared(390_000n, "kgSold", both)).toEqual({ parts: new Map([["a", 334_286n], ["b", 55_714n]]), byBirdDays: false });
  });

  it("bird-days stays the default split", () => {
    expect(splitShared(390_000n, "birdDays", both).parts).toEqual(allocate(390_000n, [{ id: "a", weight: keyWeight("birdDays", a) }, { id: "b", weight: keyWeight("birdDays", b) }]));
  });

  it("a batch with no weight gets nothing; the remainder centime goes to the largest remainder, ties in order", () => {
    expect(splitShared(390_000n, "kgSold", [{ id: "a", facts: a }, { id: "b", facts: { ...b, soldOut: [] } }]).parts).toEqual(new Map([["a", 390_000n], ["b", 0n]]));
    const same = { ...b, ...oct };
    expect(splitShared(100n, "houseArea", ["x", "y", "z"].map((id) => ({ id, facts: same }))).parts).toEqual(new Map([["x", 34n], ["y", 33n], ["z", 33n]]));
  });

  it("falls back to bird-days and says so when no batch has any weight by the key", () => {
    const unsold = both.map((x) => ({ ...x, facts: { ...x.facts, soldOut: [] } }));
    const birdDayParts = splitShared(390_000n, "birdDays", unsold).parts;
    expect(splitShared(390_000n, "kgSold", unsold)).toEqual({ parts: birdDayParts, byBirdDays: true });
    expect([...birdDayParts.values()].reduce((s, p) => s + p, 0n)).toBe(390_000n);
    // another farm's cost (facts null) stays out of the fallback too
    expect(splitShared(390_000n, "kgSold", [{ id: "a", facts: null }, { id: "b", facts: { ...b, soldOut: [] } }]).parts).toEqual(new Map([["a", 0n], ["b", 390_000n]]));
    // no batch present at all: nothing to split, whatever the key
    expect(splitShared(390_000n, "houseArea", []).parts.size).toBe(0);
    expect(splitShared(390_000n, "birdDays", both.map((x) => ({ ...x, facts: { ...x.facts, ...monthPeriod("2026-08") } })))).toEqual({ parts: new Map(), byBirdDays: false });
  });

  it("always sums to the shared cost exactly, by every key (property test)", () => {
    let seed = 11;
    const rand = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648), seed % n);
    const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
    for (let run = 0; run < 300; run++) {
      const total = BigInt(rand(10_000_000) + 1);
      const batches = Array.from({ length: rand(5) + 1 }, (_, i) => {
        const from = rand(31) + 1;
        return {
          id: `k${i}`,
          facts: { placedOn: day(from), lastDay: rand(2) ? null : day(from + rand(32 - from)), started: rand(5000), out: [], areaM2: rand(2000), soldOut: rand(2) ? [{ day: day(rand(31) + 1), grams: rand(3_000_000) }] : [], ...oct },
        };
      });
      for (const key of ["birdDays", "houseArea", "kgSold"] as AllocationKey[]) {
        const { parts } = splitShared(total, key, batches);
        if (parts.size > 0) expect([...parts.values()].reduce((s, p) => s + p, 0n)).toBe(total);
      }
    }
  });
});
