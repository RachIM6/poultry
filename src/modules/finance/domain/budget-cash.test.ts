import { describe, expect, it } from "vitest";
import { budgetCash, plainTiming, type CashTiming } from "@/modules/finance/domain/budget-cash";
import { budgetOf, type BudgetInputs } from "@/modules/finance/domain/budget";

// 1 000 chicks at 5,50; 3 000 kg of feed at 4,60 DH/kg; 500,00 of the rest; 2 000 kg sold at 14,00 DH/kg.
const inputs: BudgetInputs = {
  chicks: 1000n,
  chickPriceCentimes: 550n,
  feedGrams: 3_000_000n,
  feedPricePerKgCentimes: 460n,
  otherCostCentimes: 50_000n,
  plannedGrams: 2_000_000n,
  salePricePerKgCentimes: 1400n,
};
const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);

describe("a budget's weekly cash need (SPEC-finance FN15, §9 \"Budget cash need\")", () => {
  it("without a base batch: feed in equal daily shares, the rest on placement day, the sales on the sale day", () => {
    const cash = budgetCash(inputs, plainTiming(20)); // 21 days: 3 weeks of 7
    expect(cash.weeks.map((w) => [w.week, w.outCentimes, w.inCentimes, w.cumulativeCentimes])).toEqual([
      [1, 1_060_000n, 0n, -1_060_000n], // 5 500,00 + 500,00 + 4 600,00 (a third of the feed)
      [2, 460_000n, 0n, -1_520_000n],
      [3, 460_000n, 2_800_000n, 820_000n], // the margin, 8 200,00
    ]);
    // the sale day's feed goes out before the sale comes in: every cost, 19 800,00, is paid before the one sale
    expect(cash.peakNeedCentimes).toBe(1_980_000n);
    expect(cash.peakWeek).toBe(3);
  });

  it("the weeks sum to the budget's totals exactly, in whole centimes, whatever the weights", () => {
    const odd: BudgetInputs = { ...inputs, feedGrams: 3_333_333n, feedPricePerKgCentimes: 457n, otherCostCentimes: 12_345n, plannedGrams: 1_999_999n, salePricePerKgCentimes: 1399n };
    const b = budgetOf(odd);
    const timing: CashTiming = {
      lastDay: 44,
      feed: [[1, 7n], [3, 11n], [10, 13n], [20, 17n], [33, 19n], [44, 23n]],
      other: [[0, 3n], [5, 1n], [6, 1n], [40, 2n]],
      sales: [[38, 1_000_000n], [41, 333_333n], [44, 1n]],
    };
    const cash = budgetCash(odd, timing);
    expect(cash.weeks).toHaveLength(7);
    expect(sum(cash.weeks.map((w) => w.outCentimes))).toBe(b.plannedCostCentimes);
    expect(sum(cash.weeks.map((w) => w.inCentimes))).toBe(b.plannedSalesCentimes);
    expect(cash.weeks.at(-1)!.cumulativeCentimes).toBe(b.plannedMarginCentimes);
    for (const w of cash.weeks) expect(typeof w.outCentimes).toBe("bigint");
  });

  it("rounds each running total half up", () => {
    // 1 centime over two equal days: the first day's half rounds up to it
    const one = { ...inputs, chicks: 0n, feedGrams: 0n, otherCostCentimes: 1n, plannedGrams: 0n };
    const cash = budgetCash(one, { lastDay: 7, feed: [], other: [[0, 1n], [7, 1n]], sales: [] });
    expect(cash.weeks.map((w) => w.outCentimes)).toEqual([1n, 0n]);
    // 3 equal days of 100,00: 33,33 (33,333 down), 33,34 (66,667 up), 33,33
    const three = budgetCash({ ...one, otherCostCentimes: 10_000n }, { lastDay: 14, feed: [], other: [[0, 1n], [7, 1n], [14, 1n]], sales: [] });
    expect(three.weeks.map((w) => w.outCentimes)).toEqual([3_333n, 3_334n, 3_333n]);
  });

  it("copied from a batch: its timing, scaled to the budget's amounts", () => {
    // the base ate twice as much feed on day 3 as on day 10, spent its other costs on day 0 and day 9, sold on day 12
    const timing: CashTiming = { lastDay: 12, feed: [[3, 2n], [10, 1n]], other: [[0, 1n], [9, 4n]], sales: [[12, 5n]] };
    const cash = budgetCash(inputs, timing);
    expect(cash.weeks.map((w) => [w.outCentimes, w.inCentimes])).toEqual([
      [550_000n + 920_000n + 10_000n, 0n], // chicks, two thirds of 13 800,00, a fifth of 500,00
      [460_000n + 40_000n, 2_800_000n],
    ]);
    expect(cash.peakNeedCentimes).toBe(1_980_000n);
    expect(cash.peakWeek).toBe(2);
  });

  it("a part with no weight falls back to the plain rule; days outside the batch are clamped into it", () => {
    const cash = budgetCash(inputs, { lastDay: 13, feed: [[3, 0n]], other: [[-2, 1n]], sales: [[99, 1n]] });
    // feed: equal over 14 days (6 900,00 a week); other on day 0; sales on day 13
    expect(cash.weeks.map((w) => [w.outCentimes, w.inCentimes])).toEqual([
      [550_000n + 690_000n + 50_000n, 0n],
      [690_000n, 2_800_000n],
    ]);
  });

  it("an early sale shows the need peaking before it, and none when nothing is out of pocket", () => {
    const cash = budgetCash(inputs, { lastDay: 20, feed: [[15, 1n]], other: [], sales: [[2, 1n]] });
    expect(cash.peakNeedCentimes).toBe(600_000n); // chicks and other costs on day 0, the sale on day 2
    expect(cash.peakWeek).toBe(1);
    const free = budgetCash({ ...inputs, chicks: 0n, feedGrams: 0n, otherCostCentimes: 0n }, plainTiming(6));
    expect([free.peakNeedCentimes, free.peakWeek]).toEqual([0n, null]);
  });
});
