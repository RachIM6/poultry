import { describe, expect, it } from "vitest";
import { trialBalance } from "@/modules/finance/domain/books";
import { balanceSheet, incomeStatement } from "@/modules/finance/domain/statements";

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

describe("balanceSheet (FC8 draft bilan, CGNC classes 1 to 5)", () => {
  it("sides classes 1 and 2 by class, contra accounts deducted, classes 3 to 5 by sign", () => {
    const bs = balanceSheet([
      row("1111", -500_000n), // capital
      row("1199", 40_000n), // a past loss: deducted from the liabilities
      row("2332", 300_000n), // equipment
      row("2833", -60_000n), // its depreciation: deducted from the assets
      row("3421", 120_000n), // clients
      row("3911", -10_000n), // provision on stocks: deducted from the assets
      row("4411", -90_000n), // suppliers
      row("4415", 5_000n), // a supplier paid in advance: an asset
      row("5141", -30_000n), // an overdrawn bank: a liability
      row("5161", 25_000n), // cash
      row("712121", -100_000n),
      row("612122", 300_000n),
    ]);
    expect(bs.assets).toEqual([
      { account: "233", amount: 300_000n },
      { account: "283", amount: -60_000n },
      { account: "342", amount: 120_000n },
      { account: "391", amount: -10_000n },
      { account: "441", amount: 5_000n },
      { account: "516", amount: 25_000n },
    ]);
    expect(bs.liabilities).toEqual([
      { account: "111", amount: 500_000n },
      { account: "119", amount: -40_000n },
      { account: "441", amount: 90_000n },
      { account: "514", amount: 30_000n },
    ]);
    expect(bs.result).toBe(-200_000n);
    expect(bs.totalAssets).toBe(380_000n);
    expect(bs.totalLiabilities).toBe(380_000n);
  });

  it("balances, result included, and its result is the CPC's net, over random balanced entries", () => {
    const accounts = ["1111", "1191", "1199", "2332", "2833", "3421", "3455", "3911", "4411", "4455", "4463", "5141", "5161", "5541", "5911", "612122", "6136", "6311", "6513", "6701", "712121", "71213", "7381", "7513"];
    let seed = 42; // a fixed LCG: the same run every time
    const next = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648), seed % n);
    for (let run = 0; run < 200; run++) {
      const lines = [];
      for (let e = 0, n = 1 + next(30); e < n; e++) {
        const amount = BigInt(1 + next(1_000_000));
        lines.push({ account: accounts[next(accounts.length)], debit: amount, credit: 0n, treasuryId: null });
        lines.push({ account: accounts[next(accounts.length)], debit: 0n, credit: amount, treasuryId: null });
      }
      const tb = trialBalance(lines);
      const bs = balanceSheet(tb.rows);
      expect(tb.balanced).toBe(true);
      expect(bs.result).toBe(incomeStatement(tb.rows).net);
      expect(bs.totalAssets).toBe(bs.liabilities.reduce((s, l) => s + l.amount, 0n) + bs.result);
    }
  });

  it("is all zero without entries", () => {
    expect(balanceSheet([])).toEqual({ assets: [], liabilities: [], result: 0n, totalAssets: 0n, totalLiabilities: 0n });
  });
});
