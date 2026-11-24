import { describe, expect, it } from "vitest";
import { openingReversalOf } from "@/modules/finance/domain/close";
import { batchInProgressValue, batchesAtClose, eggsAtClose, stockAtCloseValue, stocksAtClose, suggestedValue, yearEndBatches, yearEndProvision, yearEndStock } from "@/modules/finance/domain/stocks";

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

  it("posts D 31x / C the matching 6124 leaf per kind, never 6124; the provision D 61961 / C 3912, taken back on 7196 at the opening", () => {
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
    expect(provision?.lines).toEqual([{ account: "61961", debit: 110_000n, credit: 0n }, { account: "3912", debit: 0n, credit: 110_000n }]);
    expect(openingReversalOf(provision!.lines)).toEqual([{ account: "7196", debit: 0n, credit: 110_000n }, { account: "3912", debit: 110_000n, credit: 0n }]);
    expect(openingReversalOf(yearEndStock(lines, true)!.lines.slice(0, 1))).toEqual([{ account: "3121", debit: 0n, credit: 9_890_000n }]);
    // Without the PCA the vaccine was bought on 6122: stocked with the consumables (inChart then maps 612412 → 61241).
    expect(yearEndStock(lines, false)?.lines.map((l) => [l.account, l.debit + l.credit])).toEqual([["3121", 9_840_000n], ["31221", 71_000n], ["31223", 30_000n], ["612412", 9_840_000n], ["61242", 101_000n]]);
    expect(yearEndStock([], true)).toBeNull();
    expect(yearEndProvision(stocksAtClose([item("feed", "feed", 1)], new Map([["feed", 5n]]), new Map(), new Map()))).toBeNull();
  });
});

describe("batches in progress at the close (SPEC-finance FC4, FQ19, FQ20, T109)", () => {
  // §7.1 C: 10 000 placed, 2 000 sold, 400 dead, 7 600 on hand; 182 400,00 engaged; 2 100 g; 8,50 DH/kg.
  const c = { id: "c", farmId: "f1", houseName: "B1", species: "broiler", onHand: 7600, sold: 2000, engaged: 18_240_000n };
  const weighing = { count: 50, totalGrams: 105_000 }; // 2 100 g on average
  const sale = { kind: "live" as const, pricePerKgCentimes: 850n, amountCentimes: 0n, birds: 0 };

  it("§7.1 C: 144 400,00 at cost, current value 135 660,00, provision 8 740,00; reversed on 1 January", () => {
    expect(batchInProgressValue(18_240_000n, 7600, 2000, 13_566_000n)).toEqual({ cost: 14_440_000n, provision: 874_000n });
    expect(suggestedValue(7600, weighing, sale)).toBe(13_566_000n); // 15 960 kg × 8,50
    const [line] = batchesAtClose([c], new Map([["c", weighing]]), new Map([["f1:broiler", sale]]), new Map());
    expect(line).toMatchObject({ valued: true, cost: 14_440_000n, suggested: 13_566_000n, typed: null, current: 13_566_000n, provision: 874_000n, missing: false });
    const entry = yearEndBatches([line]);
    expect(entry).toEqual({ journal: "OD", label: "Encours de production : animaux", lines: [{ account: "31322", debit: 14_440_000n, credit: 0n }, { account: "71311", debit: 0n, credit: 14_440_000n }] });
    const provision = yearEndProvision([], [line]);
    expect(provision?.lines).toEqual([{ account: "61961", debit: 874_000n, credit: 0n }, { account: "3913", debit: 0n, credit: 874_000n }]);
    // FCX5: D 71311 / C 31322 and D 3913 / C 7196.
    expect(openingReversalOf(entry!.lines)).toEqual([{ account: "31322", debit: 0n, credit: 14_440_000n }, { account: "71311", debit: 14_440_000n, credit: 0n }]);
    expect(openingReversalOf(provision!.lines)).toEqual([{ account: "7196", debit: 0n, credit: 874_000n }, { account: "3913", debit: 874_000n, credit: 0n }]);
  });

  it("one provision entry for the stocks and the batches: D 61961 for both, C 3912 and C 3913", () => {
    const stock = stocksAtClose([item("feed", "feed", 1000)], new Map([["feed", 9_840_000n]]), new Map(), new Map([["feed", 9_730_000n]]));
    const [line] = batchesAtClose([c], new Map([["c", weighing]]), new Map([["f1:broiler", sale]]), new Map());
    expect(yearEndProvision(stock, [line])?.lines).toEqual([{ account: "61961", debit: 984_000n, credit: 0n }, { account: "3912", debit: 0n, credit: 110_000n }, { account: "3913", debit: 0n, credit: 874_000n }]);
  });

  it("takes the owner's value over the suggested one; a value above cost leaves the batch at cost; a sale by the head needs no weighing", () => {
    const typed = (v: bigint) => batchesAtClose([c], new Map([["c", weighing]]), new Map([["f1:broiler", sale]]), new Map([["c", v]]))[0];
    expect(typed(14_000_000n)).toMatchObject({ typed: 14_000_000n, current: 14_000_000n, provision: 440_000n });
    expect(typed(20_000_000n)).toMatchObject({ provision: 0n });
    expect(suggestedValue(7600, null, { kind: "perHead", pricePerKgCentimes: 0n, amountCentimes: 300_000n, birds: 100 })).toBe(22_800_000n); // 30,00 a head
    expect(suggestedValue(7600, null, sale)).toBeNull(); // by the kg, no weighing
    expect(suggestedValue(7600, weighing, null)).toBeNull(); // no sale
  });

  it("requires a value for a batch with no weighing or no sale; lists pullets and layers, not valued (FQ7)", () => {
    const lines = batchesAtClose(
      [c, { ...c, id: "p", species: "pullet" }, { ...c, id: "l", species: "layer" }, { ...c, id: "t", species: "turkey" }],
      new Map(),
      new Map([["f1:broiler", sale]]),
      new Map(),
    );
    expect(lines.map((l) => [l.id, l.valued, l.cost, l.current, l.missing])).toEqual([
      ["c", true, 14_440_000n, null, true], // sold, never weighed
      ["p", false, 0n, null, false],
      ["l", false, 0n, null, false],
      ["t", true, 14_440_000n, null, true], // no turkey sold on the farm
    ]);
    expect(yearEndBatches(lines)?.lines[0]).toEqual({ account: "31322", debit: 28_880_000n, credit: 0n }); // pullets and layers left out
    expect(batchInProgressValue(18_240_000n, 0, 2000, null)).toEqual({ cost: 0n, provision: 0n }); // all sold: nothing in progress
    expect(batchesAtClose([{ ...c, onHand: 0 }], new Map(), new Map(), new Map())[0].missing).toBe(false);
    expect(yearEndBatches([])).toBeNull();
  });
});

describe("eggs at the close (SPEC-finance FC5, FQ18, T113)", () => {
  const stock = [{ farmId: "f1", eggs: 12_000 }, { farmId: "f2", eggs: 3_000 }, { farmId: "f3", eggs: 500 }];
  it("values the counted eggs, else the book ones, × the owner's value per egg; requires a value, not for eggs counted 0", () => {
    const eggs = eggsAtClose(stock, new Map([["f1", 11_800], ["f3", 0]]), new Map([["f1", 95n]]), true);
    expect(eggs.map((e) => [e.farmId, e.quantity, e.value, e.missing])).toEqual([["f1", 11_800, 1_121_000n, false], ["f2", 3_000, 0n, true], ["f3", 0, 0n, false]]);
    expect(yearEndStock([], true, eggs)?.lines).toEqual([{ account: "3152", debit: 1_121_000n, credit: 0n }, { account: "71321", debit: 0n, credit: 1_121_000n }]);
    expect(openingReversalOf(yearEndStock([], true, eggs)!.lines)).toEqual([{ account: "3152", debit: 0n, credit: 1_121_000n }, { account: "71321", debit: 1_121_000n, credit: 0n }]);
  });
  it("posts nothing for the eggs with the PCA off, and needs no value then (FQ25)", () => {
    const eggs = eggsAtClose(stock, new Map(), new Map([["f1", 95n]]), false);
    expect(eggs.map((e) => [e.posted, e.value, e.missing])).toEqual([[false, 0n, false], [false, 0n, false], [false, 0n, false]]);
    expect(yearEndStock([], false, eggs)).toBeNull();
  });
});
