import { describe, expect, it } from "vitest";
import { batchCost, checkPaidOnDelivery, liveCostPerKg } from "./closing";

// Reference batch (as kpi.test.ts), computed by hand. 10 050 chicks placed at 4,50 DH = 45 225 DH. Consumptions valued
// at weighted average cost: feed 139 650 DH + vaccines 1 200 DH + medicines 1 150 DH = 142 000 DH. Other costs:
// electricity 3 000 DH + labour 6 000 DH = 9 000 DH. Total 196 225 DH. Sold 9 720 birds at 2,3 kg = 22 356 kg.
// Cost per kg = 196 225 / 22 356 = 8,777 DH → 8,78 DH (877,73 centimes, half up).
describe("cost per kg sold (SPEC B6)", () => {
  it("matches the reference batch", () => {
    expect(batchCost({ chicksCentimes: 4_522_500n, consumedCentimes: 14_200_000n, otherCentimes: 900_000n, soldGrams: 22_356_000 })).toEqual({
      totalCentimes: 19_622_500n,
      perKgCentimes: 878n,
    });
  });

  it("rounds half up, exactly, and has no cost per kg before a sale", () => {
    expect(batchCost({ chicksCentimes: 1n, consumedCentimes: 0n, otherCentimes: 0n, soldGrams: 2000 }).perKgCentimes).toBe(1n); // 0,5 → 1
    expect(batchCost({ chicksCentimes: 1n, consumedCentimes: 0n, otherCentimes: 0n, soldGrams: 2001 }).perKgCentimes).toBe(0n); // 0,4998 → 0
    expect(batchCost({ chicksCentimes: 4_522_500n, consumedCentimes: 0n, otherCentimes: 0n, soldGrams: 0 })).toEqual({ totalCentimes: 4_522_500n, perKgCentimes: null });
  });
});

describe("paid on delivery (SPEC-finance §9)", () => {
  // 1 000 chicks at 5,00 DH + 1 000,00 DH of VAT = 6 000,00 DH
  const check = (amount: bigint) => checkPaidOnDelivery(amount, 1000, 500n, 100_000n);
  it("takes an amount above zero, up to the chicks and their VAT", () => {
    expect(check(600_000n).ok).toBe(true);
    expect(check(1n).ok).toBe(true);
    expect(check(600_001n)).toEqual({ ok: false, error: "PAID_MORE_THAN_OWED" });
    expect(check(0n)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});

// Batch.dc.html: 60 000 DH spent so far on 9 800 birds weighing 1 450 g on average = 14 210 kg live.
// 6 000 000 centimes ÷ 14 210 kg = 422,238 centimes → 4,22 DH per kg.
describe("live cost per kg of an open batch", () => {
  it("divides the costs so far by birds on hand × the latest average weight, half up", () => {
    expect(liveCostPerKg(6_000_000n, 9_800, 1_450)).toBe(422n);
    expect(liveCostPerKg(1n, 1, 2_000)).toBe(1n); // 0,5 → 1
    expect(liveCostPerKg(1n, 1, 2_001)).toBe(0n); // 0,4998 → 0
  });

  it("has none without a cost, a bird or a weighing", () => {
    expect(liveCostPerKg(0n, 9_800, 1_450)).toBeNull();
    expect(liveCostPerKg(6_000_000n, 0, 1_450)).toBeNull();
    expect(liveCostPerKg(6_000_000n, 9_800, 0)).toBeNull();
  });
});
