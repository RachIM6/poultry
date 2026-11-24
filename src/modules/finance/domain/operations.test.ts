import { describe, expect, it } from "vitest";
import { chartOf } from "@/modules/finance/domain/chart";
import { operationAccounts } from "@/modules/finance/domain/operations";
import type { AccountRow } from "@/modules/finance/schema";

const acc = (chart: "cgnc" | "pca", number: string, parent: string | null, fallback: string | null = null): AccountRow => ({ chart, number, label: `L${number}`, parent, fallback });
const all = [
  acc("cgnc", "6", null), acc("cgnc", "61", "6"), acc("cgnc", "612", "61"), acc("cgnc", "6121", "612"),
  acc("pca", "61212", "6121", "6121"), acc("pca", "612122", "61212", "6121"), acc("pca", "61213", "6121", "6121"),
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

  it("shows the owner's replacement that posts instead of the default (FN8), none without an override", () => {
    expect(rows.every((r) => r.override === null)).toBe(true);
    const overrides = new Map([["612122", "61213"], ["61473", "61212"]]); // 61212 has sub-accounts: it doesn't post
    const withPca = operationAccounts(all, { chart: chartOf(all, "cgnc", ["pca"]), overrides });
    expect(withPca.find((r) => r.op === "feed")).toMatchObject({ pca: { number: "612122" }, override: { number: "61213", label: "L61213" } });
    expect(withPca.find((r) => r.op === "expense.bank_fees")?.override).toBeNull();
    const cgncOnly = operationAccounts(all, { chart: chartOf(all, "cgnc", []), overrides }); // the PCA replacement left the chart
    expect(cgncOnly.find((r) => r.op === "feed")?.override).toBeNull();
  });
});
