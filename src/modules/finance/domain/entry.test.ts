import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { chartOf } from "@/modules/finance/domain/chart";
import { checkEntry, firstOpenMonth, fiscalYearOf, monthOf, openingLines, reversalOf, type Line } from "@/modules/finance/domain/entry";
import type { AccountRow } from "@/modules/finance/schema";

const acc = (number: string, parent: string | null, chart: "cgnc" | "pca" = "cgnc"): AccountRow => ({ chart, number, label: number, parent, fallback: null });
const chart = chartOf([acc("6", null), acc("61", "6"), acc("6121", "61"), acc("4", null), acc("44", "4"), acc("4411", "44"), acc("612122", "6121", "pca")], "cgnc", []);
const line = (account: string, debit: bigint, credit: bigint): Line => ({ account, debit, credit });

describe("an entry (SPEC-finance FN4)", () => {
  it("accepts a balanced entry on accounts of the chart", () => {
    expect(checkEntry([line("6121", 450_000n, 0n), line("4411", 0n, 450_000n)], chart)).toEqual({ ok: true, value: undefined });
  });

  it.each([
    ["unbalanced", [line("6121", 450_000n, 0n), line("4411", 0n, 449_999n)], "UNBALANCED"],
    ["a single line", [line("6121", 0n, 0n)], "TOO_FEW_LINES"],
    ["a line with both sides", [line("6121", 1n, 1n), line("4411", 0n, 0n)], "ONE_SIDE_PER_LINE"],
    ["a line with neither side", [line("6121", 0n, 0n), line("4411", 0n, 0n)], "ONE_SIDE_PER_LINE"],
    ["a negative amount", [line("6121", -5n, 0n), line("4411", 0n, -5n)], "ONE_SIDE_PER_LINE"],
    ["an account outside the chart (PCA off)", [line("612122", 100n, 0n), line("4411", 0n, 100n)], "UNKNOWN_ACCOUNT"],
    ["a class account, not a posting account", [line("6", 100n, 0n), line("4411", 0n, 100n)], "UNKNOWN_ACCOUNT"],
  ] as const)("rejects %s", (_, lines, error) => {
    expect(checkEntry([...lines], chart)).toEqual({ ok: false, error });
  });

  it("reverses with the sides swapped, same accounts and amounts", () => {
    expect(reversalOf([line("6121", 450_000n, 0n), line("4411", 0n, 450_000n)])).toEqual([line("6121", 0n, 450_000n), line("4411", 450_000n, 0n)]);
  });
});

describe("fiscal years and periods (ADR-010 §1)", () => {
  const d = (s: string) => s as FarmDay;
  it("runs from the start month for twelve months", () => {
    expect(fiscalYearOf(d("2026-11-14"), 1)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(fiscalYearOf(d("2026-03-31"), 4)).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(fiscalYearOf(d("2026-04-01"), 4)).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(fiscalYearOf(d("2024-02-29"), 3)).toEqual({ from: "2023-03-01", to: "2024-02-29" }); // leap year
  });

  it("finds the first month that isn't locked, from a given month on", () => {
    expect(monthOf(d("2026-11-14"))).toBe("2026-11");
    expect(firstOpenMonth("2026-10", new Set(["2026-10", "2026-11"]))).toBe("2026-12");
    expect(firstOpenMonth("2026-12", new Set(["2026-12"]))).toBe("2027-01");
    expect(firstOpenMonth("2026-09", new Set(["2026-10"]))).toBe("2026-09");
  });
});

describe("the à-nouveaux entry (SPEC-finance FN3)", () => {
  it("carries classes 1–5 forward and puts the year's result on 1191 or 1199, balanced", () => {
    // Balances = Σdebit − Σcredit of the previous year. Classes 6/7 make a profit of 1 000,00 here.
    const balances = new Map([["5141", 1_000_000n], ["4411", -400_000n], ["6121", 500_000n], ["7121", -1_100_000n]]);
    const lines = openingLines(balances);
    expect(lines).toEqual([line("4411", 0n, 400_000n), line("5141", 1_000_000n, 0n), line("1191", 0n, 600_000n)]);
    expect(lines.reduce((s, l) => s + l.debit - l.credit, 0n)).toBe(0n);
  });

  it("uses 1199 for a loss and skips accounts that ended at zero", () => {
    const lines = openingLines(new Map([["5161", 0n], ["5141", -200_000n], ["6121", 200_000n]]));
    expect(lines).toEqual([line("5141", 0n, 200_000n), line("1199", 200_000n, 0n)]);
  });

  it("has nothing to carry after an empty year", () => {
    expect(openingLines(new Map())).toEqual([]);
  });
});
