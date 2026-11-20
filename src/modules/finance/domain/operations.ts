import { chartOf, postingAccount } from "@/modules/finance/domain/chart";
import { POSTED_ACCOUNTS } from "@/modules/finance/domain/posting";
import { EXPENSE_ACCOUNTS } from "@/modules/finance/domain/treasury";
import type { AccountRow } from "@/modules/finance/schema";

export type OperationRow = { op: string; pca: AccountRow | null; cgnc: AccountRow | null };

/**
 * F-Chart: each operation the app posts (FN6) with its account in the agricultural chart and where it lands in the
 * general one when the PCA overlay is off (FN2 fallbacks). Built from the rules themselves, so it can't drift from them.
 */
export function operationAccounts(all: readonly AccountRow[]): OperationRow[] {
  const everything = chartOf(all, "cgnc", ["pca"]);
  const cgnc = chartOf(all, "cgnc", []);
  const ops = [...POSTED_ACCOUNTS, ...Object.entries(EXPENSE_ACCOUNTS).map(([op, account]) => ({ op: `expense.${op}`, account }))];
  return ops.map(({ op, account }) => {
    const general = postingAccount(account, everything, cgnc);
    return { op, pca: everything.get(account) ?? null, cgnc: general === null ? null : (cgnc.get(general) ?? null) };
  });
}
