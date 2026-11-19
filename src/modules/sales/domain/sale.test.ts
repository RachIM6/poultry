import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { checkSale, saleAmount, weighingGap } from "@/modules/sales/domain/sale";

describe("sale amount (SPEC V2)", () => {
  it("is weight × price per kg in integer centimes, rounded half up", () => {
    expect(saleAmount(4_000_000, 1450n)).toBe(5_800_000n); // 4 000 kg × 14,50 DH = 58 000 DH
    expect(saleAmount(2_345, 1450n)).toBe(3400n); // 2,345 kg × 14,50 = 34,0025 DH → 34,00
    expect(saleAmount(1_001, 1450n)).toBe(1451n); // 1,001 × 14,50 = 14,5145 → 14,51
    expect(saleAmount(1_000, 1n)).toBe(1n);
    expect(saleAmount(500, 1n)).toBe(1n); // 0,5 centime → up
    expect(saleAmount(499, 1n)).toBe(0n);
    expect(saleAmount(9_000_000_000, 99_999n)).toBe(899_991_000_000n); // 9 000 t, no float drift
  });
});

describe("weighing gap (SPEC V2)", () => {
  it("is farm weight − buyer weight, in grams and % of the farm weight", () => {
    expect(weighingGap(4_000_000, 3_920_000)).toEqual({ grams: 80_000, percent: 2 });
    expect(weighingGap(4_000_000, 4_040_000)).toEqual({ grams: -40_000, percent: -1 }); // the buyer weighed more
    expect(weighingGap(4_000_000, null)).toBeNull();
  });
});

describe("checking a sale (SPEC V2, V3)", () => {
  const sale = {
    birds: 2000,
    farmWeightGrams: 4_000_000,
    buyerWeightGrams: 3_920_000,
    pricePerKgCentimes: 1450n,
    paymentMethod: "cash" as const,
    paidCentimes: 5_800_000n,
    instrument: null,
  };

  it("is refused while a withdrawal runs on the sale day, whatever else", () => {
    expect(checkSale(sale, "2026-11-13" as FarmDay)).toEqual({ ok: false, error: "WITHDRAWAL_IN_PROGRESS" });
    expect(checkSale(sale, null)).toEqual({ ok: true, value: { amountCentimes: 5_800_000n } });
  });

  it("needs birds, weights and a price, and can't be paid more than its amount", () => {
    expect(checkSale({ ...sale, birds: 0 }, null)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(checkSale({ ...sale, buyerWeightGrams: 0 }, null)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(checkSale({ ...sale, pricePerKgCentimes: 0n }, null)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(checkSale({ ...sale, paidCentimes: 5_800_001n }, null)).toEqual({ ok: false, error: "PAID_MORE_THAN_AMOUNT" });
    expect(checkSale({ ...sale, buyerWeightGrams: null, paymentMethod: "credit", paidCentimes: 0n }, null).ok).toBe(true);
  });

  it("takes a number and a due date for a cheque or a bill, and only for them", () => {
    const instrument = { number: "0012345", dueOn: "2026-12-15" };
    expect(checkSale({ ...sale, paymentMethod: "cheque", paidCentimes: 0n }, null)).toEqual({ ok: false, error: "INSTRUMENT_REQUIRED" });
    expect(checkSale({ ...sale, paymentMethod: "bill", paidCentimes: 0n, instrument }, null).ok).toBe(true);
    expect(checkSale({ ...sale, instrument }, null)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});
