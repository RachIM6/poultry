import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { chartOf } from "@/modules/finance/domain/chart";
import { checkOverride, OVERRIDABLE, overridesAt, withOverrides } from "@/modules/finance/domain/overrides";
import { inChart, postingOf } from "@/modules/finance/domain/posting";
import type { AccountRow } from "@/modules/finance/schema";

const acc = (chart: "cgnc" | "pca", number: string, parent: string | null, fallback: string | null = null): AccountRow => ({ chart, number, label: number, parent, fallback });
const all = [
  acc("cgnc", "6", null), acc("cgnc", "61", "6"), acc("cgnc", "612", "61"), acc("cgnc", "6121", "612"), acc("cgnc", "6122", "612"),
  acc("pca", "61212", "6121", "6121"), acc("pca", "612121", "61212", "6121"), acc("pca", "612122", "61212", "6121"), acc("pca", "612124", "61212", "6121"),
  acc("cgnc", "7", null), acc("cgnc", "71", "7"), acc("cgnc", "7121", "71"),
  acc("cgnc", "4", null), acc("cgnc", "4411", "4"), acc("cgnc", "5", null), acc("cgnc", "5161", "5"),
];
const pca = chartOf(all, "cgnc", ["pca"]);
const cgnc = chartOf(all, "cgnc", []);
const feed = postingOf({ type: "purchase", id: "p", day: "2026-03-02" as FarmDay, itemKind: "feed", amount: 900_000n, paid: 0n })!;
const at = (iso: string) => new Date(iso);

describe("posting overrides (SPEC-finance FN8)", () => {
  it("offers FN6's charge and revenue rules only, never a balance-sheet account", () => {
    expect(OVERRIDABLE.map((o) => o.account)).toEqual(expect.arrayContaining(["612122", "712121", "61711", "612512", "6136"]));
    expect(OVERRIDABLE.every((o) => /^[67]/.test(o.account))).toBe(true);
    expect(checkOverride("4411", "4411", pca)).toEqual({ ok: false, error: "NOT_OVERRIDABLE" });
    expect(checkOverride("5161", null, pca)).toEqual({ ok: false, error: "NOT_OVERRIDABLE" });
  });

  it("takes a posting account of the entity's chart, in the default's class; null goes back to the default", () => {
    expect(checkOverride("612122", "612124", pca)).toEqual({ ok: true, value: undefined });
    expect(checkOverride("612122", null, pca)).toEqual({ ok: true, value: undefined });
    expect(checkOverride("612122", "61212", pca)).toEqual({ ok: false, error: "UNKNOWN_ACCOUNT" }); // has sub-accounts (FN4)
    expect(checkOverride("612122", "699999", pca)).toEqual({ ok: false, error: "UNKNOWN_ACCOUNT" }); // not in the chart
    expect(checkOverride("612122", "612124", cgnc)).toEqual({ ok: false, error: "UNKNOWN_ACCOUNT" }); // a PCA account, PCA off
    expect(checkOverride("612122", "6122", cgnc)).toEqual({ ok: true, value: undefined });
    expect(checkOverride("612122", "7121", pca)).toEqual({ ok: false, error: "WRONG_ACCOUNT_CLASS" }); // a charge stays a charge
    expect(checkOverride("712121", "6122", pca)).toEqual({ ok: false, error: "WRONG_ACCOUNT_CLASS" });
  });

  it("reads the overrides in force at a time from the history; a null row puts the default back", () => {
    const history = [
      { ruleAccount: "612122", account: "612124", savedAt: at("2026-03-01T10:00:00Z") },
      { ruleAccount: "712121", account: "7121", savedAt: at("2026-03-05T10:00:00Z") },
      { ruleAccount: "612122", account: null, savedAt: at("2026-04-01T10:00:00Z") },
    ];
    expect(overridesAt(history, at("2026-02-28T00:00:00Z"))).toEqual(new Map());
    expect(overridesAt(history, at("2026-03-01T10:00:00Z"))).toEqual(new Map([["612122", "612124"]]));
    expect(overridesAt(history, at("2026-03-10T00:00:00Z"))).toEqual(new Map([["612122", "612124"], ["712121", "7121"]]));
    expect(overridesAt(history, null)).toEqual(new Map([["712121", "7121"]]));
  });

  it("replaces the overridden rule account on every line, the others stay", () => {
    expect(withOverrides(feed, new Map([["612122", "612124"]]), pca).lines).toEqual([
      { account: "612124", debit: 900_000n, credit: 0n },
      { account: "4411", debit: 0n, credit: 900_000n },
    ]);
    expect(withOverrides(feed, new Map(), pca)).toBe(feed);
  });

  it("skips a replacement that is no longer a posting account of the chart: the default lands as usual (FN2)", () => {
    const overridden = withOverrides(feed, new Map([["612122", "612124"]]), cgnc); // saved with the PCA, then switched off
    expect(inChart(overridden, pca, cgnc)?.lines.map((l) => l.account)).toEqual(["6121", "4411"]);
    expect(inChart(withOverrides(feed, new Map([["612122", "6122"]]), cgnc), pca, cgnc)?.lines.map((l) => l.account)).toEqual(["6122", "4411"]);
  });
});
