import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { chartOf } from "@/modules/finance/domain/chart";
import { inChart, postingOf, samePosting } from "@/modules/finance/domain/posting";
import type { AccountRow } from "@/modules/finance/schema";

const day = "2026-03-02" as FarmDay;
const acc = (chart: "cgnc" | "pca", number: string, parent: string | null, fallback: string | null = null): AccountRow => ({ chart, number, label: number, parent, fallback });
const all = [
  acc("cgnc", "6", null), acc("cgnc", "61", "6"), acc("cgnc", "612", "61"), acc("cgnc", "6121", "612"), acc("cgnc", "6122", "612"),
  acc("pca", "61212", "6121", "6121"), acc("pca", "612121", "61212", "6121"), acc("pca", "612122", "61212", "6121"), acc("pca", "612123", "61212", "6122"),
  acc("cgnc", "4", null), acc("cgnc", "4411", "4"), acc("cgnc", "5", null), acc("cgnc", "5161", "5"),
];
const everything = chartOf(all, "cgnc", ["pca"]);
const cgncOnly = chartOf(all, "cgnc", []);

describe("default posting rules (SPEC-finance FN6)", () => {
  it("posts a feed purchase on credit: D 612122 / C 4411", () => {
    expect(postingOf({ type: "purchase", id: "p", day, itemKind: "feed", amount: 900_000n, paid: 0n })?.lines).toEqual([
      { account: "612122", debit: 900_000n, credit: 0n },
      { account: "4411", debit: 0n, credit: 900_000n },
    ]);
  });

  it("splits a purchase paid in part at once between the supplier and the cash box", () => {
    expect(postingOf({ type: "purchase", id: "p", day, itemKind: "vaccine", amount: 900_000n, paid: 300_000n })?.lines).toEqual([
      { account: "612123", debit: 900_000n, credit: 0n },
      { account: "4411", debit: 0n, credit: 600_000n },
      { account: "5161", debit: 0n, credit: 300_000n },
    ]);
  });

  it("posts the chicks bought at placement: D 612121 / C 4411", () => {
    expect(postingOf({ type: "chicks", id: "b", day, amount: 4_400_000n })?.lines.map((l) => l.account)).toEqual(["612121", "4411"]);
  });

  it("posts nothing for a zero amount", () => {
    expect(postingOf({ type: "chicks", id: "b", day, amount: 0n })).toBeNull();
  });

  it("maps to the CGNC accounts when the PCA is off (FN2)", () => {
    const feed = postingOf({ type: "purchase", id: "p", day, itemKind: "feed", amount: 100n, paid: 0n })!;
    expect(inChart(feed, everything, cgncOnly)?.lines.map((l) => l.account)).toEqual(["6121", "4411"]);
    const vet = postingOf({ type: "purchase", id: "p", day, itemKind: "medicine", amount: 100n, paid: 0n })!;
    expect(inChart(vet, everything, cgncOnly)?.lines.map((l) => l.account)).toEqual(["6122", "4411"]);
    expect(inChart(feed, everything, everything)?.lines.map((l) => l.account)).toEqual(["612122", "4411"]);
  });

  it("tells a change that leaves the books alone from one that doesn't", () => {
    const lines = [{ account: "612121", debit: 5n, credit: 0n }, { account: "4411", debit: 0n, credit: 5n }];
    expect(samePosting({ day, lines }, { day, lines: [...lines].reverse() })).toBe(true);
    expect(samePosting({ day, lines }, { day: "2026-03-03", lines })).toBe(false);
    expect(samePosting({ day, lines }, { day, lines: [{ ...lines[0], debit: 6n }, { ...lines[1], credit: 6n }] })).toBe(false);
  });
});
