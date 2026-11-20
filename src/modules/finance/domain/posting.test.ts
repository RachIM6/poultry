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

  it("posts a live-bird sale to the buyer, with what was received at once (FN6)", () => {
    const sale = (method: string, paid: bigint) => postingOf({ type: "sale", id: "s", day, amount: 1_000_000n, paid, method });
    expect(sale("credit", 0n)).toEqual({ journal: "VT", label: "Vente", lines: [{ account: "3421", debit: 1_000_000n, credit: 0n }, { account: "712121", debit: 0n, credit: 1_000_000n }] });
    expect(sale("cheque", 600_000n)?.lines.slice(2)).toEqual([{ account: "5111", debit: 600_000n, credit: 0n }, { account: "3421", debit: 0n, credit: 600_000n }]);
    expect(sale("bill", 600_000n)?.lines[2].account).toBe("3425");
    expect(sale("cash", 1_000_000n)?.lines[2].account).toBe("5161");
    expect(postingOf({ type: "receipt", id: "p", day, amount: 5n, method: "transfer" })).toMatchObject({ journal: "BQ", lines: [{ account: "5141", debit: 5n }, { account: "3421", credit: 5n }] });
  });

  it("posts an egg sale to 71213, 7121 without the PCA; a per-head sale like a live one (SPEC-m3 V8)", () => {
    const withEggs = chartOf([...all, acc("cgnc", "7", null), acc("cgnc", "71", "7"), acc("cgnc", "712", "71"), acc("cgnc", "7121", "712"), acc("pca", "71213", "7121", "7121"), acc("pca", "712121", "7121", "7121"), acc("cgnc", "3421", "4")], "cgnc", ["pca"]);
    const plain = chartOf([...all, acc("cgnc", "7", null), acc("cgnc", "71", "7"), acc("cgnc", "712", "71"), acc("cgnc", "7121", "712"), acc("pca", "71213", "7121", "7121"), acc("cgnc", "3421", "4")], "cgnc", []);
    const eggs = postingOf({ type: "sale", id: "s", day, amount: 49_500n, paid: 0n, method: "credit", kind: "eggs" })!;
    expect(eggs).toMatchObject({ label: "Vente d’œufs", lines: [{ account: "3421", debit: 49_500n }, { account: "71213", credit: 49_500n }] });
    expect(inChart(eggs, withEggs, withEggs)?.lines.map((l) => l.account)).toEqual(["3421", "71213"]);
    expect(inChart(eggs, withEggs, plain)?.lines.map((l) => l.account)).toEqual(["3421", "7121"]);
    expect(postingOf({ type: "sale", id: "s", day, amount: 79_000n, paid: 0n, method: "credit", kind: "perHead" })?.lines[1].account).toBe("712121");
  });

  it("follows a received cheque or bill (FN11): cashed D 5141 / C 5111, unpaid D 3424, remitted bill D 5113 / C 3425", () => {
    const step = (kind: "cheque" | "bill", from: string, to: string) => postingOf({ type: "instrument", id: "i", day, amount: 600_000n, kind, from, to })?.lines.map((l) => [l.account, l.debit, l.credit]);
    expect(step("cheque", "in_portfolio", "cashed")).toEqual([["5141", 600_000n, 0n], ["5111", 0n, 600_000n]]);
    expect(step("cheque", "in_portfolio", "unpaid")).toEqual([["3424", 600_000n, 0n], ["5111", 0n, 600_000n]]);
    expect(step("cheque", "in_portfolio", "remitted")).toBeUndefined(); // still on 5111: nothing to post
    expect(step("bill", "in_portfolio", "remitted")).toEqual([["5113", 600_000n, 0n], ["3425", 0n, 600_000n]]);
    expect(step("bill", "remitted", "cashed")).toEqual([["5141", 600_000n, 0n], ["5113", 0n, 600_000n]]);
    expect(step("bill", "remitted", "unpaid")).toEqual([["3424", 600_000n, 0n], ["5113", 0n, 600_000n]]);
  });

  it("tells a change that leaves the books alone from one that doesn't", () => {
    const lines = [{ account: "612121", debit: 5n, credit: 0n }, { account: "4411", debit: 0n, credit: 5n }];
    expect(samePosting({ day, lines }, { day, lines: [...lines].reverse() })).toBe(true);
    expect(samePosting({ day, lines }, { day: "2026-03-03", lines })).toBe(false);
    expect(samePosting({ day, lines }, { day, lines: [{ ...lines[0], debit: 6n }, { ...lines[1], credit: 6n }] })).toBe(false);
  });
});

describe("VAT (SPEC-finance FN9)", () => {
  const purchase = { type: "purchase", id: "p", day, itemKind: "feed", amount: 1_200_000n, paid: 200_000n, vat: 200_000n } as const;
  const sale = { type: "sale", id: "s", day, amount: 1_100_000n, paid: 0n, method: "credit", vat: 100_000n } as const;

  it("puts a registered entity's recoverable VAT on 3455, the rest on the charge", () => {
    expect(postingOf(purchase, true)?.lines).toEqual([
      { account: "612122", debit: 1_000_000n, credit: 0n },
      { account: "3455", debit: 200_000n, credit: 0n },
      { account: "4411", debit: 0n, credit: 1_000_000n },
      { account: "5161", debit: 0n, credit: 200_000n },
    ]);
  });

  it("puts a registered entity's collected VAT on 4455, the rest on the sale", () => {
    expect(postingOf(sale, true)?.lines).toEqual([
      { account: "3421", debit: 1_100_000n, credit: 0n },
      { account: "712121", debit: 0n, credit: 1_000_000n },
      { account: "4455", debit: 0n, credit: 100_000n },
    ]);
  });

  it("keeps the whole total on the charge or the sale when the entity is not registered (the default)", () => {
    expect(postingOf(purchase)?.lines[0]).toEqual({ account: "612122", debit: 1_200_000n, credit: 0n });
    expect(postingOf(sale)?.lines.map((l) => l.account)).toEqual(["3421", "712121"]);
  });

  it("posts no VAT line when the invoice has none", () => {
    expect(postingOf({ ...sale, vat: 0n }, true)?.lines.map((l) => l.account)).toEqual(["3421", "712121"]);
  });
});

describe("supplier payments (SPEC-finance FN6)", () => {
  const pay = (method: string) => postingOf({ type: "supplierPayment", id: "p", day, amount: 250_000n, method });
  it.each([
    ["cash", "CA", "5161"],
    ["transfer", "BQ", "5141"],
    ["cheque", "BQ", "5141"], // on the issue date
    ["bill", "OD", "4415"], // the accepted bill replaces the supplier debt
  ])("%s: D 4411 / C %s in %s", (method, journal, account) => {
    expect(pay(method)).toEqual({ journal, label: "Paiement fournisseur", lines: [{ account: "4411", debit: 250_000n, credit: 0n }, { account, debit: 0n, credit: 250_000n }] });
  });
});
