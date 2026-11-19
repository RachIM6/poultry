import { describe, expect, it } from "vitest";
import { batchCost } from "./closing";

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
