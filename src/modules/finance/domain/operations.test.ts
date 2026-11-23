import { describe, expect, it } from "vitest";
import { operationAccounts } from "@/modules/finance/domain/operations";
import type { AccountRow } from "@/modules/finance/schema";

const acc = (chart: "cgnc" | "pca", number: string, parent: string | null, fallback: string | null = null): AccountRow => ({ chart, number, label: `L${number}`, parent, fallback });
const all = [
  acc("cgnc", "6", null), acc("cgnc", "61", "6"), acc("cgnc", "612", "61"), acc("cgnc", "6121", "612"),
  acc("pca", "61212", "6121", "6121"), acc("pca", "612122", "61212", "6121"),
  acc("cgnc", "3", null), acc("cgnc", "3421", "3"), acc("cgnc", "614", "61"), acc("cgnc", "6147", "614"), acc("cgnc", "61473", "6147"),
];

describe("operationAccounts (F-Chart)", () => {
  const rows = operationAccounts(all);

  it("shows a PCA account and where it lands in the general chart", () => {
    expect(rows.find((r) => r.op === "feed")).toMatchObject({ pca: { number: "612122" }, cgnc: { number: "6121", label: "L6121" } });
  });

  it("shows a general account the same in both columns", () => {
    expect(rows.find((r) => r.op === "buyers")).toMatchObject({ pca: { number: "3421" }, cgnc: { number: "3421" } });
  });

  it("lists every posting rule and quick-expense category, unknown accounts as null", () => {
    expect(rows.map((r) => r.op)).toEqual(expect.arrayContaining(["chicks", "birdsSold", "vatCollected", "expense.electricity"]));
    expect(rows.find((r) => r.op === "vatCollected")).toMatchObject({ pca: null, cgnc: null });
  });

  it("shows bank fees on 61473 Frais et commissions sur services bancaires in both charts (FC9, T119)", () => {
    expect(rows.find((r) => r.op === "expense.bank_fees")).toMatchObject({ pca: { number: "61473" }, cgnc: { number: "61473", label: "L61473" } });
  });
});
