import { describe, expect, it } from "vitest";
import { allocate, batchComparison, batchResult, birdDays, monthPeriod } from "@/modules/finance/domain/batch";

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
  it("gives mortality, FCR, feed price and sale price per kg, as integers", () => {
    // 10 000 started, 420 lost; 31 200 kg of feed for 4 500 000,00 DH; 18 000 kg sold for 2 700 000,00 DH
    expect(batchComparison({ started: 10_000, lost: 420, feedGrams: 31_200_000n, feedCentimes: 14_040_000n, soldGrams: 18_000_000n, salesCentimes: 27_000_000n })).toEqual({
      lostPermille: 42n, // 4,2 %
      fcrMilli: 1733n, // 1,733
      feedPricePerKgCentimes: 450n, // 4,50 DH
      pricePerKgCentimes: 1500n, // 15,00 DH
    });
  });

  it("has nothing to say before anything was eaten or sold", () => {
    expect(batchComparison({ started: 0, lost: 0, feedGrams: 0n, feedCentimes: 0n, soldGrams: 0n, salesCentimes: 0n })).toEqual({ lostPermille: null, fcrMilli: null, feedPricePerKgCentimes: null, pricePerKgCentimes: null });
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
