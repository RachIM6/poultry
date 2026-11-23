import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chartOf, leafAccounts } from "@/modules/finance/domain/chart";
import * as hens from "@/modules/finance/domain/hens";
import { AccountsFile } from "@/modules/finance/schema";

// SPEC-finance FC6 (T114, T115): the hens accounts in the seeded chart (accounts.test.ts covers the other rules).
describe("laying hens' accounts (FC6)", () => {
  it("posts every hens account on a leaf of the chart with the PCA (FN4), 61943 seeded under 6194", () => {
    const seed = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    const leaves = new Set(leafAccounts(chartOf(seed.accounts, "cgnc", ["pca"])).map((a) => a.number));
    const accounts = Object.entries(hens).flatMap(([name, value]) => (name.startsWith("HENS_") && typeof value === "string" ? [value] : []));
    expect(accounts).toHaveLength(14);
    for (const account of accounts) expect(leaves.has(account), account).toBe(true);
  });
});
