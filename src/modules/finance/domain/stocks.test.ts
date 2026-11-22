import { describe, expect, it } from "vitest";
import { openingReversalOf } from "@/modules/finance/domain/close";
import { stockAtCloseValue, stocksAtClose, yearEndProvision, yearEndStock } from "@/modules/finance/domain/stocks";

const item = (id: string, kind: "feed" | "vaccine" | "litter" | "gas" | "other", onHand: number) => ({ id, farmId: "f1", kind, name: id, unit: "kg" as const, lot: null, onHand });

describe("stocks at the close (SPEC-finance FC5, FQ20, T108)", () => {
  it("§7 stockAtCloseValue: 98 400 vs 97 300 → 97 300, provision 1 100,00; at cost without a lower current value", () => {
    expect(stockAtCloseValue(9_840_000n, 9_730_000n)).toEqual({ value: 9_730_000n, provision: 110_000n });
    expect(stockAtCloseValue(9_840_000n, null)).toEqual({ value: 9_840_000n, provision: 0n }); // FQ20: cost
    expect(stockAtCloseValue(9_840_000n, 10_000_000n)).toEqual({ value: 9_840_000n, provision: 0n }); // never above cost
  });

  it("values the counted quantity, else the book one, at the day's average cost, half up; lines with nothing to value at, not valued", () => {
    const items = [item("feed", "feed", 3_000_000), item("gas", "gas", 30), item("found", "other", 5), item("none", "litter", 10)];
    const values = new Map([["feed", 1_380_000n], ["gas", 100n], ["found", 0n]]); // 3 t of feed at 4,60 DH/kg; 30 units for 1,00
    const lines = stocksAtClose(items, values, new Map([["feed", 2_950_500], ["gas", 7]]), new Map([["feed", 1_000_000n]]));
    expect(lines.map((l) => [l.id, l.quantity, l.cost, l.value, l.provision])).toEqual([
      ["feed", 2_950_500, 1_357_230n, 1_000_000n, 357_230n], // 2 950,5 kg × 4,60
      ["gas", 7, 23n, 23n, 0n], // 7 × 100 ÷ 30 = 23,33 → 23
      ["found", 5, null, 0n, 0n], // no purchase cost
      ["none", 10, null, 0n, 0n], // never bought
    ]);
    expect(stocksAtClose([item("feed", "feed", 3_000_000)], values, new Map([["feed", 0]]), new Map())[0].cost).toBeNull(); // counted none
  });

  it("posts D 31x / C the matching 6124 leaf per kind, never 6124; the provision D 6196 / C 3912, taken back on 7196 at the opening", () => {
    const lines = stocksAtClose(
      [item("feed", "feed", 1000), item("vaccine", "vaccine", 1000), item("litter", "litter", 1000), item("gas", "gas", 1000), item("other", "other", 1000)],
      new Map([["feed", 9_840_000n], ["vaccine", 50_000n], ["litter", 20_000n], ["gas", 30_000n], ["other", 1_000n]]),
      new Map(),
      new Map([["feed", 9_730_000n]]),
    );
    expect(yearEndStock(lines, true)).toEqual({
      journal: "OD",
      label: "Stocks de fin d’exercice",
      lines: [
        { account: "3121", debit: 9_890_000n, credit: 0n },
        { account: "31221", debit: 21_000n, credit: 0n },
        { account: "31223", debit: 30_000n, credit: 0n },
        { account: "612412", debit: 0n, credit: 9_890_000n },
        { account: "61242", debit: 0n, credit: 51_000n },
      ],
    });
    const provision = yearEndProvision(lines);
    expect(provision?.lines).toEqual([{ account: "6196", debit: 110_000n, credit: 0n }, { account: "3912", debit: 0n, credit: 110_000n }]);
    expect(openingReversalOf(provision!.lines)).toEqual([{ account: "7196", debit: 0n, credit: 110_000n }, { account: "3912", debit: 110_000n, credit: 0n }]);
    expect(openingReversalOf(yearEndStock(lines, true)!.lines.slice(0, 1))).toEqual([{ account: "3121", debit: 0n, credit: 9_890_000n }]);
    // Without the PCA the vaccine was bought on 6122: stocked with the consumables (inChart then maps 612412 → 61241).
    expect(yearEndStock(lines, false)?.lines.map((l) => [l.account, l.debit + l.credit])).toEqual([["3121", 9_840_000n], ["31221", 71_000n], ["31223", 30_000n], ["612412", 9_840_000n], ["61242", 101_000n]]);
    expect(yearEndStock([], true)).toBeNull();
    expect(yearEndProvision(stocksAtClose([item("feed", "feed", 1)], new Map([["feed", 5n]]), new Map(), new Map()))).toBeNull();
  });
});
