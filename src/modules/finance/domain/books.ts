import type { Line } from "@/modules/finance/domain/entry";

// SPEC-finance FN16. Pure: the books are views of the same ledger lines.

export type TrialBalanceRow = { account: string; debit: bigint; credit: bigint; balance: bigint }; // balance = debit − credit

/** FN16: Σdebit and Σcredit per account, in account order, with the totals. Balanced when the two totals are equal. */
export function trialBalance(lines: readonly Line[]): { rows: TrialBalanceRow[]; debit: bigint; credit: bigint; balanced: boolean } {
  const by = new Map<string, TrialBalanceRow>();
  for (const l of lines) {
    const r = by.get(l.account) ?? { account: l.account, debit: 0n, credit: 0n, balance: 0n };
    r.debit += l.debit;
    r.credit += l.credit;
    r.balance = r.debit - r.credit;
    by.set(l.account, r);
  }
  const rows = [...by.values()].sort((a, b) => a.account.localeCompare(b.account));
  const debit = rows.reduce((s, r) => s + r.debit, 0n);
  const credit = rows.reduce((s, r) => s + r.credit, 0n);
  return { rows, debit, credit, balanced: debit === credit };
}

/** One movement of money in the cash book: money in (receipt) or out (expense), against what. */
export type CashBookRow = { entryId: string; day: string; label: string; account: string; counterAccounts: string[]; receipt: bigint; expense: bigint };

// FN16, ADR-010 §1: cash, bank and cheque accounts (51xx), but not 5115 (virements de fonds): a transfer only passes
// through it, and its two legs show on the accounts it moves money between.
const isMoney = (account: string) => account.startsWith("51") && account !== "5115";

/** FN16: the receipts-and-expenses book of a `cash_book` entity: every line on a cash, bank or cheque account. */
export function cashBookOf(entries: readonly { id: string; day: string; label: string; lines: readonly Line[] }[]) {
  const rows: CashBookRow[] = [];
  for (const e of entries) {
    const others = e.lines.filter((l) => !l.account.startsWith("51")).map((l) => l.account);
    for (const l of e.lines) {
      // A transfer between two treasury accounts moves money inside the books: it shows twice, in and out.
      if (isMoney(l.account)) rows.push({ entryId: e.id, day: e.day, label: e.label, account: l.account, counterAccounts: others, receipt: l.debit, expense: l.credit });
    }
  }
  rows.sort((a, b) => a.day.localeCompare(b.day));
  const receipts = rows.reduce((s, r) => s + r.receipt, 0n);
  const expenses = rows.reduce((s, r) => s + r.expense, 0n);
  return { rows, receipts, expenses, net: receipts - expenses };
}
