import { describe, expect, it } from "vitest";
import { valuate, type ValuedMovement } from "./valuation";

const kg = (n: number) => n * 1000; // grams
let n = 0;
const id = () => `0190a000-0000-7000-8000-${String(++n).padStart(12, "0")}`;
const buy = (day: string, quantity: number, amountCentimes: bigint): ValuedMovement => ({ id: id(), day, quantity, purchaseAmountCentimes: amountCentimes });
const use = (day: string, quantity: number): ValuedMovement => ({ id: id(), day, quantity: -quantity });

describe("weighted average valuation (SPEC S5)", () => {
  it("matches the hand calculation: 3 purchases at different prices, 2 consumptions", () => {
    // By hand:
    //   1 000 kg × 4,00 = 4 000,00 DH                 → 1 000 kg, 4 000,00 DH (4,00/kg)
    //     500 kg × 4,60 = 2 300,00 DH                 → 1 500 kg, 6 300,00 DH (4,20/kg)
    //   use 600 kg × 4,20 = 2 520,00 DH               →   900 kg, 3 780,00 DH
    //     300 kg × 5,00 = 1 500,00 DH                 → 1 200 kg, 5 280,00 DH (4,40/kg)
    //   use 700 kg × 4,40 = 3 080,00 DH               →   500 kg, 2 200,00 DH
    const c1 = use("2026-11-08", kg(600));
    const c2 = use("2026-11-12", kg(700));
    const result = valuate([
      buy("2026-11-01", kg(1000), 400_000n),
      buy("2026-11-05", kg(500), 230_000n),
      c1,
      buy("2026-11-10", kg(300), 150_000n),
      c2,
    ]);
    expect(result.costs.get(c1.id)).toBe(252_000n);
    expect(result.costs.get(c2.id)).toBe(308_000n);
    expect(result).toMatchObject({ onHand: kg(500), valueCentimes: 220_000n });
  });

  it("uses ledger order, not the order movements arrived on the phone", () => {
    const early = buy("2026-11-01", kg(100), 40_000n);
    const late = buy("2026-11-03", kg(100), 60_000n);
    const between = use("2026-11-02", kg(50));
    expect(valuate([late, between, early]).costs.get(between.id)).toBe(20_000n); // only the first purchase existed
  });

  it("loses no centime to rounding: costs + remaining value = what was paid", () => {
    const thirds = [use("2026-11-02", 1), use("2026-11-03", 1), use("2026-11-04", 1)];
    const result = valuate([buy("2026-11-01", 3, 100n), ...thirds]);
    const costs = thirds.map((m) => result.costs.get(m.id)!);
    expect(costs).toEqual([33n, 34n, 33n]); // 100/3 → 33, 67/2 → 34 (half up), 33
    expect(costs.reduce((a, b) => a + b) + result.valueCentimes).toBe(100n);
  });

  it("values found stock at the current average, and charges nothing once stock is gone", () => {
    const found = { id: id(), day: "2026-11-02", quantity: kg(10) };
    const overdraw = use("2026-11-03", kg(200));
    const result = valuate([buy("2026-11-01", kg(100), 50_000n), found, overdraw, use("2026-11-04", kg(5))]);
    expect(result.costs.get(overdraw.id)).toBe(55_000n); // only the 110 kg there were
    expect(result).toMatchObject({ onHand: kg(-95), valueCentimes: 0n });
  });
});
