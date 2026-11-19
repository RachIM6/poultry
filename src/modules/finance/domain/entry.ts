import type { FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import type { ChartOfAccounts } from "@/modules/finance/domain/chart";

/** One line of a journal entry: amounts in centimes (FX1), exactly one side above zero. */
export type Line = { account: string; debit: bigint; credit: bigint };

export type EntryError = "TOO_FEW_LINES" | "ONE_SIDE_PER_LINE" | "UNKNOWN_ACCOUNT" | "UNBALANCED";

/**
 * SPEC-finance FN4: at least two lines, each with one side only, on posting accounts of the entity's chart (an
 * account with sub-accounts, like the class "6", isn't one), and Σdebit = Σcredit. The database re-checks the
 * balance at commit.
 */
export function checkEntry(lines: readonly Line[], chart: ChartOfAccounts): Result<void, EntryError> {
  if (lines.length < 2) return fail("TOO_FEW_LINES");
  if (lines.some((l) => l.debit < 0n || l.credit < 0n || (l.debit > 0n) === (l.credit > 0n))) return fail("ONE_SIDE_PER_LINE");
  const parents = new Set([...chart.values()].map((a) => a.parent));
  if (lines.some((l) => !chart.has(l.account) || parents.has(l.account))) return fail("UNKNOWN_ACCOUNT");
  const total = lines.reduce((s, l) => s + l.debit - l.credit, 0n);
  return total === 0n ? ok(undefined) : fail("UNBALANCED");
}

/** SPEC-finance FN5: a correction first cancels the posted entry with the same lines, sides swapped. */
export const reversalOf = (lines: readonly Line[]): Line[] => lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit }));

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month: 1–12

/** ADR-010 §1: the fiscal year holding `day`, starting on the 1st of `startMonth` (1–12) and lasting twelve months. */
export function fiscalYearOf(day: FarmDay, startMonth: number): { from: FarmDay; to: FarmDay } {
  const [y, m] = day.split("-").map(Number);
  const fromYear = m >= startMonth ? y : y - 1;
  const endMonth = ((startMonth + 10) % 12) + 1; // the month before the start
  const toYear = startMonth === 1 ? fromYear : fromYear + 1;
  return { from: `${fromYear}-${pad(startMonth)}-01` as FarmDay, to: `${toYear}-${pad(endMonth)}-${pad(lastDay(toYear, endMonth))}` as FarmDay };
}

/** The accounting period of a day: its calendar month, "YYYY-MM". */
export const monthOf = (day: FarmDay) => day.slice(0, 7);

/** SPEC-finance FN5: a correction of a locked period goes to the first open period from `month` on. */
export function firstOpenMonth(month: string, locked: ReadonlySet<string>): string {
  let [y, m] = month.split("-").map(Number);
  while (locked.has(`${y}-${pad(m)}`)) [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  return `${y}-${pad(m)}`;
}

// Classes 1–5 are the balance sheet, 6–7 the income statement (CGNC).
const BALANCE_SHEET = new Set(["1", "2", "3", "4", "5"]);
const PROFIT = "1191"; // Résultat net de l'exercice (créditeur), PCA / CGNC nomenclature
const LOSS = "1199"; // Résultat net de l'exercice (débiteur)

/**
 * SPEC-finance FN3: the à-nouveaux entry opening a fiscal year, from the previous year's closing balances
 * (Σdebit − Σcredit per account). Classes 1–5 are carried forward; the net result of classes 6–7 lands on 1191
 * (profit) or 1199 (loss) until it is allocated, so the entry balances. ⚠️ for the accountant (ADR-010 is proposed).
 */
export function openingLines(balances: ReadonlyMap<string, bigint>): Line[] {
  const lines: Line[] = [];
  let result = 0n; // Σ classes 6–7: negative = profit
  for (const [account, balance] of [...balances].sort(([a], [b]) => a.localeCompare(b))) {
    if (!BALANCE_SHEET.has(account[0])) result += balance;
    else if (balance !== 0n) lines.push(balance > 0n ? { account, debit: balance, credit: 0n } : { account, debit: 0n, credit: -balance });
  }
  if (result < 0n) lines.push({ account: PROFIT, debit: 0n, credit: -result });
  if (result > 0n) lines.push({ account: LOSS, debit: result, credit: 0n });
  return lines;
}
