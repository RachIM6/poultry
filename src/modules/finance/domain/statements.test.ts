import { describe, expect, it } from "vitest";
import { incomeStatement } from "@/modules/finance/domain/statements";

const row = (account: string, balance: bigint) => ({ account, debit: balance > 0n ? balance : 0n, credit: balance < 0n ? -balance : 0n, balance });

describe("incomeStatement (CPC, CGNC classes 6 and 7)", () => {
  const cpc = incomeStatement([
    row("712121", -1_000_000n), // birds sold
    row("71213", -200_000n), // eggs sold
    row("612122", 700_000n), // feed
    row("6136", 50_000n), // vet fees
    row("6311", 30_000n), // interest
    row("7381", -5_000n), // other financial income
    row("6513", 10_000n), // non-current charge
    row("6701", 20_000n), // income tax
    row("3421", 999n), // not in the CPC
    row("4411", -999n),
  ]);

  it("groups each section by its 3-digit accounts, income positive", () => {
    expect(cpc.sections[0]).toEqual({
      key: "operating",
      income: [{ account: "712", amount: 1_200_000n }],
      charges: [{ account: "612", amount: 700_000n }, { account: "613", amount: 50_000n }],
      result: 450_000n,
    });
  });

  it("chains operating, financial, current, non-current, tax and net results", () => {
    expect(cpc.sections.map((s) => [s.key, s.result])).toEqual([["operating", 450_000n], ["financial", -25_000n], ["nonCurrent", -10_000n], ["tax", -20_000n]]);
    expect(cpc.current).toBe(425_000n);
    expect(cpc.beforeTax).toBe(415_000n);
    expect(cpc.net).toBe(395_000n);
  });

  it("is all zero without entries", () => {
    expect(incomeStatement([]).net).toBe(0n);
  });
});
