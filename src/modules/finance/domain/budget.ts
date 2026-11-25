// SPEC-finance FN15, §7. Pure and Zod-free: the /budget screen recomputes it on every keystroke, the server saves it.

/** The what-if inputs of a planned batch, in integer units (FX1). */
export type BudgetInputs = {
  chicks: bigint;
  chickPriceCentimes: bigint;
  feedGrams: bigint;
  feedPricePerKgCentimes: bigint;
  otherCostCentimes: bigint; // everything else: vaccines and medicines, other costs, expenses, allocated shared costs
  plannedGrams: bigint; // kg sold, farm weight
  salePricePerKgCentimes: bigint;
};

export type Budget = {
  feedCostCentimes: bigint;
  plannedCostCentimes: bigint;
  plannedSalesCentimes: bigint;
  plannedMarginCentimes: bigint;
  breakEvenPerKgCentimes: bigint | null; // the sale price per kg that covers the cost; null with nothing to sell
};

/**
 * a × b ÷ c rounded half up, for non-negative amounts: divHalfUp(a × b, c) of @/lib/kernel/money, which this file can't
 * import (prisma/seed.ts loads it under plain Node, ../shared.ts). budget.test.ts holds the two together.
 */
export const mulDiv = (a: bigint, b: bigint, c: bigint) => (a * b * 2n + c) / (2n * c);

/** §7: planned cost ÷ planned kg (270 800,00 ÷ 23 700 kg → 11,43 DH/kg). */
export const breakEvenPrice = (costCentimes: bigint, grams: bigint): bigint | null => (grams > 0n ? mulDiv(costCentimes, 1000n, grams) : null);

/** FN15: what a planned batch costs, brings in and leaves, for these inputs. */
export function budgetOf(i: BudgetInputs): Budget {
  const feedCostCentimes = mulDiv(i.feedGrams, i.feedPricePerKgCentimes, 1000n);
  const plannedCostCentimes = i.chicks * i.chickPriceCentimes + feedCostCentimes + i.otherCostCentimes;
  const plannedSalesCentimes = mulDiv(i.plannedGrams, i.salePricePerKgCentimes, 1000n);
  return {
    feedCostCentimes,
    plannedCostCentimes,
    plannedSalesCentimes,
    plannedMarginCentimes: plannedSalesCentimes - plannedCostCentimes,
    breakEvenPerKgCentimes: breakEvenPrice(plannedCostCentimes, i.plannedGrams),
  };
}
