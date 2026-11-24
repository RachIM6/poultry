import { chartOf, leafAccounts, postingAccount, type ChartOfAccounts } from "@/modules/finance/domain/chart";
import { POSTED_ACCOUNTS } from "@/modules/finance/domain/posting";
import { EXPENSE_ACCOUNTS } from "@/modules/finance/domain/treasury";
import type { AccountRow } from "@/modules/finance/schema";

export type OperationRow = { op: string; pca: AccountRow | null; cgnc: AccountRow | null; override: AccountRow | null };

/** Each operation the app posts (FN6) and its rule account, as the rules hold it (PCA number). */
export const OPERATIONS: readonly { op: string; account: string }[] = [...POSTED_ACCOUNTS, ...Object.entries(EXPENSE_ACCOUNTS).map(([op, account]) => ({ op: `expense.${op}`, account }))];

/**
 * F-Chart: each operation the app posts (FN6) with its account in the agricultural chart and where it lands in the
 * general one when the PCA overlay is off (FN2 fallbacks). Built from the rules themselves, so it can't drift from them.
 * FN8: with the entity's chart and overrides, the replacement that posts instead of the default (one that is no longer
 * a posting account of the chart doesn't post, so it isn't shown).
 */
export function operationAccounts(all: readonly AccountRow[], entity?: { chart: ChartOfAccounts; overrides: ReadonlyMap<string, string> }): OperationRow[] {
  const everything = chartOf(all, "cgnc", ["pca"]);
  const cgnc = chartOf(all, "cgnc", []);
  const leaves = new Set(entity && entity.overrides.size > 0 ? leafAccounts(entity.chart).map((a) => a.number) : []);
  return OPERATIONS.map(({ op, account }) => {
    const general = postingAccount(account, everything, cgnc);
    const to = entity?.overrides.get(account);
    return { op, pca: everything.get(account) ?? null, cgnc: general === null ? null : (cgnc.get(general) ?? null), override: (to && leaves.has(to) && entity?.chart.get(to)) || null };
  });
}
