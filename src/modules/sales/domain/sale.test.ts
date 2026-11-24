import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { checkEggSale, checkHeadSale, checkSale, eggLineAmount, saleAmount, weighingGap } from "@/modules/sales/domain/sale";

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
    expect(checkSale({ ...sale, vatCentimes: 5_800_001n }, null)).toEqual({ ok: false, error: "VAT_MORE_THAN_AMOUNT" }); // FN9
    expect(checkSale({ ...sale, vatCentimes: 5_800_000n }, null).ok).toBe(true);
    expect(checkSale({ ...sale, buyerWeightGrams: null, paymentMethod: "credit", paidCentimes: 0n }, null).ok).toBe(true);
  });

  it("takes a number and a due date for a cheque or a bill, and only for them", () => {
    const instrument = { number: "0012345", dueOn: "2026-12-15" };
    expect(checkSale({ ...sale, paymentMethod: "cheque", paidCentimes: 0n }, null)).toEqual({ ok: false, error: "INSTRUMENT_REQUIRED" });
    expect(checkSale({ ...sale, paymentMethod: "bill", paidCentimes: 0n, instrument }, null).ok).toBe(true);
    expect(checkSale({ ...sale, instrument }, null)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});

describe("egg sales (SPEC-m3 V6)", () => {
  const line = (eggs: number, unitPriceCentimes: bigint, eggsPerTray = 30) => ({ item: "grade:m", eggs, eggsPerTray, unitPriceCentimes });

  it("prices eggs per tray, half up to the centime, with 30 or 12 eggs a tray", () => {
    expect(eggLineAmount(line(1080 * 30, 3300n))).toBe(3_564_000n); // P-EggStock: 1 080 trays × 33,00 = 35 640,00 DH
    expect(eggLineAmount(line(45, 3300n))).toBe(4950n); // 1,5 tray
    expect(eggLineAmount(line(7, 1000n, 12))).toBe(583n); // 583,33… → 583
    expect(eggLineAmount(line(1, 1000n, 12))).toBe(83n); // 83,33… → 83
    expect(eggLineAmount(line(3, 5n, 2))).toBe(8n); // 7,5 → 8: half up
  });

  it("sums its lines and applies the payment rules", () => {
    const sale = { lines: [line(1200, 3300n), line(1410, 2000n)], paymentMethod: "cash" as const, paidCentimes: 0n, instrument: null };
    expect(checkEggSale(sale)).toEqual({ ok: true, value: { amountCentimes: 132_000n + 94_000n } });
    expect(checkEggSale({ ...sale, lines: [] })).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(checkEggSale({ ...sale, lines: [line(0, 3300n)] })).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(checkEggSale({ ...sale, paidCentimes: 226_001n })).toEqual({ ok: false, error: "PAID_MORE_THAN_AMOUNT" });
    expect(checkEggSale({ ...sale, vatCentimes: 226_001n })).toEqual({ ok: false, error: "VAT_MORE_THAN_AMOUNT" });
    expect(checkEggSale({ ...sale, paymentMethod: "cheque" })).toEqual({ ok: false, error: "INSTRUMENT_REQUIRED" });
  });
});

describe("sale per head (SPEC-m3 V7)", () => {
  // P-Beldi: 6 roosters at 85,00 and 4 hens at 70,00.
  const sale = {
    lines: [
      { item: "rooster" as const, birds: 6, pricePerHeadCentimes: 8500n },
      { item: "hen" as const, birds: 4, pricePerHeadCentimes: 7000n },
    ],
    farmWeightGrams: null,
    paymentMethod: "cash" as const,
    paidCentimes: 79_000n,
    instrument: null,
  };

  it("sums birds × price per head, the farm weight optional", () => {
    expect(checkHeadSale(sale, null)).toEqual({ ok: true, value: { amountCentimes: 79_000n, birds: 10 } });
    expect(checkHeadSale({ ...sale, farmWeightGrams: 18_500 }, null).ok).toBe(true);
    expect(checkHeadSale({ ...sale, farmWeightGrams: 0 }, null)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(checkHeadSale({ ...sale, lines: [{ item: "bird", birds: 0, pricePerHeadCentimes: 1n }] }, null)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(checkHeadSale({ ...sale, paidCentimes: 79_001n }, null)).toEqual({ ok: false, error: "PAID_MORE_THAN_AMOUNT" });
    expect(checkHeadSale({ ...sale, vatCentimes: 79_001n }, null)).toEqual({ ok: false, error: "VAT_MORE_THAN_AMOUNT" });
  });

  it("is blocked during a withdrawal, like a sale per kg (V3)", () => {
    expect(checkHeadSale(sale, "2026-11-20" as FarmDay)).toEqual({ ok: false, error: "WITHDRAWAL_IN_PROGRESS" });
  });
});
