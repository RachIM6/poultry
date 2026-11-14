import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AccountsFile } from "@/modules/finance/schema";
import { chartOf, postingAccount, rollUp } from "@/modules/finance";

const seed = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
const everything = chartOf(seed.accounts, "cgnc", ["pca"]);
const withPca = everything;
const cgncOnly = chartOf(seed.accounts, "cgnc", []);

// Every account of SPEC-finance FN6's default posting rules, until T30 turns them into PostingRule rows.
// [rule account, account posted with PCA off (FN2's "CGNC parent" column)]
const RULE_ACCOUNTS: [string, string][] = [
  ["612121", "6121"], ["612122", "6121"], ["612123", "6122"],
  ["61221", "6122"], ["61223", "6122"], ["612511", "6125"], ["612512", "6125"], ["612612", "6126"],
  ["712121", "7121"], ["712128", "7121"], ["71213", "7121"],
  ["4411", "4411"], ["4415", "4415"], ["4463", "4463"],
  ["3421", "3421"], ["3424", "3424"], ["3425", "3425"], ["3431", "3431"],
  ["5111", "5111"], ["5113", "5113"], ["5115", "5115"], ["5141", "5141"], ["5161", "5161"],
  ["6134", "6134"], ["6136", "6136"],
];

describe("charts of accounts (SPEC-finance FN2, ADR-010 §2)", () => {
  it("has every account the default posting rules use, in both charts they target", () => {
    for (const [account, withoutPca] of RULE_ACCOUNTS) {
      expect(postingAccount(account, everything, withPca), account).toBe(account);
      expect(postingAccount(account, everything, cgncOnly), account).toBe(withoutPca);
    }
  });

  it("rolls up through the explicit parent: 612122 → 61212 → 6121 → 612 → 61 → 6", () => {
    expect(rollUp("612122", withPca)).toEqual(["612122", "61212", "6121", "612", "61", "6"]);
    expect(rollUp("712121", withPca)).toEqual(["712121", "71212", "7121", "712", "71", "7"]);
  });

  it("is a tree: every parent exists in the same charts, every account reaches its class", () => {
    for (const a of seed.accounts) {
      const path = rollUp(a.number, a.chart === "cgnc" ? cgncOnly : withPca);
      expect(path.at(-1), a.number).toBe(a.number[0]);
    }
    expect(new Set(seed.accounts.map((a) => `${a.chart}:${a.number}`)).size).toBe(seed.accounts.length);
  });

  it("keeps PCA accounts out of a chart without the overlay", () => {
    expect(cgncOnly.has("612122")).toBe(false);
    expect(() => rollUp("612122", cgncOnly)).toThrow();
  });

  // The official PCA nests 612123 under 61212 → 6121; without the PCA, FN2 posts vet products to 6122 (consumables).
  it("keeps the official tree for roll-ups and FN2's fallback for posting", () => {
    expect(rollUp("612123", withPca)).toEqual(["612123", "61212", "6121", "612", "61", "6"]);
    expect(postingAccount("612123", everything, cgncOnly)).toBe("6122");
  });

  it("has a fallback in the base chart for every overlay account", () => {
    for (const a of seed.accounts.filter((x) => x.chart !== "cgnc")) expect(cgncOnly.has(a.fallback ?? ""), a.number).toBe(true);
  });
});
