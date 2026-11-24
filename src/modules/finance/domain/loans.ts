import type { FarmDay } from "@/lib/kernel/farm-day";
import { divHalfUp } from "@/lib/kernel/money";
import { fail, ok, type Result } from "@/lib/kernel/result";
import type { Posting } from "@/modules/finance/domain/posting";

// SPEC-finance FC2 (T105), pure: a loan's schedule (§7 `loanSchedule`, §7.1 B) and its entries.

export const LOANS = "1481"; // Emprunts auprès des établissements de crédit
export const LOAN_INTEREST = "63111"; // Intérêts des emprunts (6311 is subdivided, FN4; CGNC scan p. 298)
const BANK = "5141";

export const LOAN_FREQUENCIES = ["monthly", "quarterly"] as const;
export type LoanFrequency = (typeof LOAN_FREQUENCIES)[number];
const MONTHS: Record<LoanFrequency, number> = { monthly: 1, quarterly: 3 };

/** What the contract says. `rate`: annual, in 1/100 000 (5,55 % → 5 550). `deferral`: periods of interest only. */
export type LoanTerms = { principal: bigint; rate: number; frequency: LoanFrequency; installments: number; deferral: number; firstDueOn: FarmDay };
export type ScheduleRow = { number: number; dueOn: FarmDay; capital: bigint; interest: bigint };

const pad = (n: number) => String(n).padStart(2, "0");

/** FC2: `months` after `first`, on the same day of the month, clamped to the month's end (31 Mar + 3 → 30 Jun). */
export function dueDay(first: FarmDay, months: number): FarmDay {
  const [y, m, d] = first.split("-").map(Number);
  const index = y * 12 + m - 1 + months;
  const [year, month] = [Math.floor(index / 12), (index % 12) + 1];
  return `${year}-${pad(month)}-${pad(Math.min(d, new Date(Date.UTC(year, month, 0)).getUTCDate()))}` as FarmDay;
}

/**
 * FC2, §7 `loanSchedule`, default FQ16: d + n rows, one per period from the first due day. During the deferral the
 * capital is 0; then capital = principal ÷ n half up, and the last row takes what is left. Interest = outstanding ×
 * rate ÷ (100 000 × periods per year), half up, not counted by days.
 */
export function loanSchedule(t: LoanTerms): ScheduleRow[] {
  const months = MONTHS[t.frequency];
  const capital = divHalfUp(t.principal, BigInt(t.installments));
  const rows: ScheduleRow[] = [];
  let outstanding = t.principal;
  for (let k = 0; k < t.deferral + t.installments; k++) {
    // capped at what is owed: on a tiny principal over many rows, rounded rows could pass it and leave the last one negative
    const c = k < t.deferral ? 0n : k === t.deferral + t.installments - 1 ? outstanding : capital < outstanding ? capital : outstanding;
    rows.push({ number: k + 1, dueOn: dueDay(t.firstDueOn, k * months), capital: c, interest: divHalfUp(outstanding * BigInt(t.rate), 100_000n * BigInt(12 / months)) });
    outstanding -= c;
  }
  return rows;
}

export type LoanError = "INVALID_INPUT" | "FIRST_DUE_BEFORE_DISBURSEMENT" | "CAPITAL_NOT_PRINCIPAL";

/** FC2: the first installment falls after the money came in (an opening-balance loan has no disbursement here). */
export const checkLoan = (disbursedOn: FarmDay | null, firstDueOn: FarmDay): Result<void, LoanError> =>
  disbursedOn !== null && firstDueOn <= disbursedOn ? fail("FIRST_DUE_BEFORE_DISBURSEMENT") : ok(undefined);

/** FC2: what the owner may confirm. No row below zero (a tiny principal over many rows), and the capital adds up to the principal. */
export function checkSchedule(principal: bigint, rows: readonly Pick<ScheduleRow, "capital" | "interest">[]): Result<void, LoanError> {
  if (rows.some((r) => r.capital < 0n || r.interest < 0n)) return fail("INVALID_INPUT");
  return rows.reduce((s, r) => s + r.capital, 0n) === principal ? ok(undefined) : fail("CAPITAL_NOT_PRINCIPAL");
}

/** FC2 disbursement: D 5141 (the bank account it is paid into) / C 1481, `BQ`. */
export const disbursementPosting = (lender: string, principal: bigint, treasuryId: string): Posting => ({
  journal: "BQ",
  label: `Déblocage d’emprunt : ${lender}`,
  lines: [{ account: BANK, debit: principal, credit: 0n, treasuryId }, { account: LOANS, debit: 0n, credit: principal }],
});

/** FC2 installment paid: D 1481 capital, D 63111 interest / C 5141, `BQ`. Null for a row of nothing. */
export function installmentPosting(lender: string, row: Pick<ScheduleRow, "number" | "capital" | "interest">, treasuryId: string): Posting | null {
  const total = row.capital + row.interest;
  if (total === 0n) return null;
  return {
    journal: "BQ",
    label: `Échéance d’emprunt n° ${row.number} : ${lender}`,
    lines: [
      ...(row.capital > 0n ? [{ account: LOANS, debit: row.capital, credit: 0n }] : []),
      ...(row.interest > 0n ? [{ account: LOAN_INTEREST, debit: row.interest, credit: 0n }] : []),
      { account: BANK, debit: 0n, credit: total, treasuryId },
    ],
  };
}
