import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { classicYearEnd, flockYear, hensMethodOf, layPosting, simplifiedProvision, simplifiedValue, simplifiedYearEnd, type LayingFlock } from "@/modules/finance/domain/hens";
import { postingOf } from "@/modules/finance/domain/posting";

// SPEC-finance FC6 (T114, T115): the laying hens' rules, pure.

const d = (s: string) => s as FarmDay;
const y2026 = { from: d("2026-01-01"), to: d("2026-12-31") };
const y2027 = { from: d("2027-01-01"), to: d("2027-12-31") };
const balanced = (lines: { debit: bigint; credit: bigint }[]) => lines.reduce((s, l) => s + l.debit - l.credit, 0n) === 0n;
// §7 `straightLine` fixture: hens 252 000 − 90 000, life 14 months, entered in June (7 months in the first year)
const flock = (over: Partial<LayingFlock> = {}): LayingFlock => ({
  entry: 25_200_000n,
  entryDay: d("2026-06-01"),
  lifeMonths: 14,
  cullValue: 9_000_000n,
  started: 1000,
  out: [],
  sold: [],
  closedOn: null,
  ...over,
});

describe("laying hens, classic method (FC6, T115)", () => {
  it("depreciates straight line over the laying period: 252 000 − 90 000 over 14 months, 7 months → 81 000,00 (§7)", () => {
    expect(flockYear(flock(), y2026.from, y2026.to)).toEqual({ charge: 8_100_000n, gross: 0n, accumulated: 0n, sold: 0n, lost: 0n });
    expect(flockYear(flock(), y2027.from, y2027.to).charge).toBe(8_100_000n); // the 7 months left: the base is spread in full
  });

  it("removes the culled share of the gross and the accumulated, the schedule going on over the rest (FQ8)", () => {
    const culled = flock({ entry: 252_000n, cullValue: 90_000n, out: [{ day: "2027-03-15", birds: 250 }], sold: [{ day: "2027-03-15", birds: 250 }] });
    // 2027: Jan–Feb on the whole flock, 81 000 × 2 ÷ 7 = 23 142,86 → 23 143; then a quarter leaves (accumulated 104 143 ÷ 4
    // = 26 035,75 → 26 036); March–July on the rest: 189 000 − 67 500 − 78 107 = 43 393, all of it (5 of 5 months left).
    expect(flockYear(culled, y2027.from, y2027.to)).toEqual({ charge: 66_536n, gross: 63_000n, accumulated: 26_036n, sold: 36_964n, lost: 0n });
    expect(flockYear(culled, y2026.from, y2026.to)).toEqual({ charge: 81_000n, gross: 0n, accumulated: 0n, sold: 0n, lost: 0n });
  });

  it("sends the net book value to 6187 when the last hens are sold, to 6513 when the flock is lost without a sale", () => {
    const base = { entry: 252_000n, cullValue: 90_000n, closedOn: "2026-09-10" };
    // June–August: 162 000 × 3 ÷ 14 = 34 714,29 → 34 714; the cull month isn't depreciated
    const sold = flockYear(flock({ ...base, out: [{ day: "2026-09-10", birds: 1000 }], sold: [{ day: "2026-09-10", birds: 1000 }] }), y2026.from, y2026.to);
    expect(sold).toEqual({ charge: 34_714n, gross: 252_000n, accumulated: 34_714n, sold: 217_286n, lost: 0n });
    const lost = flockYear(flock({ ...base, out: [{ day: "2026-09-10", birds: 1000 }] }), y2026.from, y2026.to);
    expect(lost).toEqual({ charge: 34_714n, gross: 252_000n, accumulated: 34_714n, sold: 0n, lost: 217_286n });
    expect(flockYear(flock({ ...base, out: [{ day: "2026-09-10", birds: 1000 }] }), y2027.from, y2027.to)).toEqual({ charge: 0n, gross: 0n, accumulated: 0n, sold: 0n, lost: 0n });
  });

  it("carries the dead by the survivors: deaths alone remove nothing", () => {
    expect(flockYear(flock({ out: [{ day: "2026-08-01", birds: 100 }] }), y2026.from, y2026.to).charge).toBe(8_100_000n);
  });

  it("posts the year-end entry: D 23962 / C 71431, D 61937 / C 28371, D 28371 + D 6187 / C 23711", () => {
    const fy = { charge: 66_536n, gross: 63_000n, accumulated: 26_036n, sold: 36_964n, lost: 0n };
    const p = classicYearEnd(5_000n, [fy])!;
    expect(p.lines).toEqual([
      { account: "23962", debit: 5_000n, credit: 0n },
      { account: "71431", debit: 0n, credit: 5_000n },
      { account: "61937", debit: 66_536n, credit: 0n },
      { account: "28371", debit: 0n, credit: 66_536n },
      { account: "28371", debit: 26_036n, credit: 0n },
      { account: "6187", debit: 36_964n, credit: 0n },
      { account: "23711", debit: 0n, credit: 63_000n },
    ]);
    expect(balanced(p.lines)).toBe(true);
    expect(classicYearEnd(0n, [])).toBeNull();
  });

  it("capitalises at the transfer to lay what no close did, then clears 23962 into 23711 (FQ7c)", () => {
    expect(layPosting(1_000n, 300n)!.lines).toEqual([
      { account: "23962", debit: 700n, credit: 0n },
      { account: "71431", debit: 0n, credit: 700n },
      { account: "23711", debit: 1_000n, credit: 0n },
      { account: "23962", debit: 0n, credit: 1_000n },
    ]);
    expect(layPosting(1_000n, 1_000n)!.lines.map((l) => l.account)).toEqual(["23711", "23962"]);
    expect(layPosting(0n, 0n)).toBeNull();
  });

  it("books point-of-lay hens bought on 23711 and culled hens sold on 7187, only under the classic method", () => {
    const chicks = { type: "chicks" as const, id: "b", day: d("2026-06-01"), amount: 100n, layers: true };
    expect(postingOf(chicks, false, true)!.lines.map((l) => l.account)).toEqual(["23711", "4481"]); // a fixed asset's debt (FC1)
    expect(postingOf(chicks, false, false)!.lines.map((l) => l.account)).toEqual(["612121", "4411"]);
    expect(postingOf({ ...chicks, layers: false }, false, true)!.lines[0].account).toBe("612121");
    const sale = { type: "sale" as const, id: "s", day: d("2026-09-10"), amount: 100n, paid: 0n, method: "cash", kind: "live" as const, layers: true };
    expect(postingOf(sale, false, true)!.lines[1].account).toBe("7187");
    expect(postingOf(sale, false, false)!.lines[1].account).toBe("712121");
    expect(postingOf({ ...sale, kind: "eggs" }, false, true)!.lines[1].account).toBe("71213");
    expect(postingOf({ type: "lay", id: "lay:b", day: d("2026-06-01"), amount: 100n, capitalised: 0n }, false, false)).toBeNull();
  });
});

describe("laying hens, simplified method (FC6, T114)", () => {
  it("values birds counted × entry value per bird, and provisions what the current value falls short of", () => {
    expect(simplifiedValue("layer", 100_000n, 1000, 950, 0)).toBe(95_000n);
    expect(simplifiedValue("layer", 100_000n, 3, 1, 0)).toBe(33_333n); // half up once
    expect(simplifiedValue("pullet", 60_000n, 1000, 900, 100)).toBe(54_000n); // FN13 cost by head, as FC4
    expect(simplifiedProvision(95_000n, 90n, 950)).toBe(9_500n);
    expect(simplifiedProvision(95_000n, 120n, 950)).toBe(0n);
  });

  it("posts the year's value on 23711 / 7151 and 23712 / 7152, reverses the previous year's and its provision", () => {
    const previous = [
      { account: "7151", debit: 70_000n, credit: 0n }, // that year's own reversal: not taken back again
      { account: "23711", debit: 0n, credit: 70_000n },
      { account: "23711", debit: 80_000n, credit: 0n },
      { account: "7151", debit: 0n, credit: 80_000n },
      { account: "61943", debit: 2_000n, credit: 0n },
      { account: "2937", debit: 0n, credit: 2_000n },
    ];
    const p = simplifiedYearEnd(
      [
        { species: "layer", value: 95_000n, provision: 9_500n },
        { species: "pullet", value: 54_000n, provision: 0n },
      ],
      previous,
    )!;
    expect(p.lines).toEqual([
      { account: "7151", debit: 80_000n, credit: 0n },
      { account: "23711", debit: 0n, credit: 80_000n },
      { account: "2937", debit: 2_000n, credit: 0n },
      { account: "7194", debit: 0n, credit: 2_000n },
      { account: "23711", debit: 95_000n, credit: 0n },
      { account: "7151", debit: 0n, credit: 95_000n },
      { account: "23712", debit: 54_000n, credit: 0n },
      { account: "7152", debit: 0n, credit: 54_000n },
      { account: "61943", debit: 9_500n, credit: 0n },
      { account: "2937", debit: 0n, credit: 9_500n },
    ]);
    expect(balanced(p.lines)).toBe(true);
    expect(simplifiedYearEnd([], [])).toBeNull();
  });
});

describe("laying hens' books (FC6)", () => {
  it("values the hens only in a ledger with the PCA (FQ25: nothing with the PCA off, no balance sheet in a cash book)", () => {
    expect(hensMethodOf({ books: "ledger", overlays: ["pca"] }, "simplified")).toBe("simplified");
    expect(hensMethodOf({ books: "ledger", overlays: [] }, "classic")).toBeNull();
    expect(hensMethodOf({ books: "cash_book", overlays: ["pca"] }, "classic")).toBeNull();
  });
});
