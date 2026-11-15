import { describe, expect, it } from "vitest";
import { breakEvenPrice, budgetOf, type BudgetInputs } from "@/modules/finance/domain/budget";

describe("budget and break-even (SPEC-finance FN15, §7)", () => {
  it("break-even: 270 800,00 ÷ 23 700 kg → 11,43 DH/kg", () => {
    expect(breakEvenPrice(27_080_000n, 23_700_000n)).toBe(1143n);
    expect(breakEvenPrice(1n, 0n)).toBeNull();
  });

  // 12 000 chicks at 5,50; 40 t of feed at 4,60 DH/kg; 30 000,00 of the rest; 23 700 kg sold at 13,30 DH/kg.
  const base: BudgetInputs = {
    chicks: 12_000n,
    chickPriceCentimes: 550n,
    feedGrams: 40_000_000n,
    feedPricePerKgCentimes: 460n,
    otherCostCentimes: 3_000_000n,
    plannedGrams: 23_700_000n,
    salePricePerKgCentimes: 1330n,
  };

  it("recomputes the cost, the break-even and the margin from the inputs", () => {
    expect(budgetOf(base)).toEqual({
      feedCostCentimes: 18_400_000n, // 40 000 kg × 4,60
      plannedCostCentimes: 28_000_000n, // 66 000,00 + 184 000,00 + 30 000,00
      plannedSalesCentimes: 31_521_000n, // 23 700 kg × 13,30
      plannedMarginCentimes: 3_521_000n,
      breakEvenPerKgCentimes: 1181n, // 280 000,00 ÷ 23 700 kg
    });
  });

  it("moves the break-even with the feed price and the margin with the sale price", () => {
    const dearerFeed = budgetOf({ ...base, feedPricePerKgCentimes: 500n }); // +0,40 DH/kg on 40 t = +16 000,00
    expect(dearerFeed.plannedCostCentimes).toBe(29_600_000n);
    expect(dearerFeed.breakEvenPerKgCentimes).toBe(1249n);
    const lowerPrice = budgetOf({ ...base, salePricePerKgCentimes: 1150n }); // below the break-even: a loss
    expect(lowerPrice.plannedMarginCentimes).toBe(27_255_000n - 28_000_000n);
    expect(lowerPrice.breakEvenPerKgCentimes).toBe(1181n); // the sale price doesn't move the break-even
  });
});
