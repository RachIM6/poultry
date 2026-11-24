import { fail, ok, type Result } from "@/lib/kernel/result";
import { leafAccounts, type ChartOfAccounts } from "@/modules/finance/domain/chart";
import { OPERATIONS } from "@/modules/finance/domain/operations";
import type { Posting } from "@/modules/finance/domain/posting";

/**
 * SPEC-finance FN8: the default rules whose account the owner can override, FN6's charges (class 6) and revenues
 * (class 7). Balance-sheet accounts stay as the rules say: the treasury, the debts, the cheques and the VAT read them by
 * number (§9 "Posting overrides").
 */
export const OVERRIDABLE = OPERATIONS.filter((o) => /^[67]/.test(o.account));

export type OverrideError = "NOT_OVERRIDABLE" | "UNKNOWN_ACCOUNT" | "WRONG_ACCOUNT_CLASS";

const leavesOf = (chart: ChartOfAccounts) => new Set(leafAccounts(chart).map((a) => a.number));

/**
 * FN8, FN4: the replacement of a rule's account is a posting account of the entity's chart, in the default's class (a
 * charge stays a charge). Null goes back to the default.
 */
export function checkOverride(ruleAccount: string, account: string | null, chart: ChartOfAccounts): Result<void, OverrideError> {
  if (!OVERRIDABLE.some((o) => o.account === ruleAccount)) return fail("NOT_OVERRIDABLE");
  if (account === null) return ok(undefined);
  if (!leavesOf(chart).has(account)) return fail("UNKNOWN_ACCOUNT");
  return account[0] === ruleAccount[0] ? ok(undefined) : fail("WRONG_ACCOUNT_CLASS");
}

export type SavedOverride = { ruleAccount: string; account: string | null; savedAt: Date };

/** FN8: rule account → replacement, as saved up to `at` (everything saved when null). `history` in saving order. */
export function overridesAt(history: readonly SavedOverride[], at: Date | null): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const h of history) {
    if (at && h.savedAt > at) break;
    if (h.account) overrides.set(h.ruleAccount, h.account);
    else overrides.delete(h.ruleAccount);
  }
  return overrides;
}

/**
 * FN8: the rule's posting with each overridden account replaced. A replacement that is no longer a posting account of
 * the chart (the PCA switched off since) is skipped: the default stands, mapped to the chart as usual (FN2, FN4).
 */
export function withOverrides(p: Posting, overrides: ReadonlyMap<string, string>, chart: ChartOfAccounts): Posting {
  if (overrides.size === 0) return p;
  const leaves = leavesOf(chart);
  return {
    ...p,
    lines: p.lines.map((l) => {
      const to = overrides.get(l.account);
      return to && leaves.has(to) ? { ...l, account: to } : l;
    }),
  };
}
