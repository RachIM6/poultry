// What the phone's screens need from finance, without Zod (ADR-009). Relative imports only: prisma/seed.ts loads
// ./schema.ts, which re-exports this file, under plain Node.
export { bankOnly, EXPENSE_ACCOUNTS, EXPENSE_CATEGORIES, PAID_FROM, TREASURY_KINDS, treasuryKindOfAccount } from "./domain/treasury.ts";
export type { ExpenseCategory, PaidFrom, TreasuryKind } from "./domain/treasury.ts";
export { breakEvenPrice, budgetOf } from "./domain/budget.ts";
export type { Budget, BudgetInputs } from "./domain/budget.ts";
export { budgetCash, plainTiming } from "./domain/budget-cash.ts";
export type { BudgetCash, CashTiming, CashWeek } from "./domain/budget-cash.ts";
export { CSV_DATE_FORMATS, CSV_SEPARATORS } from "./domain/bank-import.ts";
export type { CsvMapping } from "./domain/bank-import.ts";

export type TreasuryAccountDto = { id: string; kind: "bank" | "cash"; name: string };
/** FX4: a quick expense, recorded on the phone. Money: never sent to workers (FX2). */
export type ExpenseDto = {
  id: string;
  day: string; // farm day
  category: "electricity" | "water" | "vet_fees" | "insurance" | "catching" | "bank_fees";
  amountCentimes: string;
  vatCentimes?: string; // SPEC-finance FN9: part of amountCentimes; absent before it was asked
  paidFrom: "cash" | "bank" | "credit";
  treasuryId: string | null;
  note: string | null;
  // FN13, FN14: one batch's direct charge, or shared over a month's batches by bird-days; neither: general.
  batchId?: string | null;
  serviceMonth?: string | null; // "2026-10": a shared expense's service period (default: the month of its day)
  receiptFileId?: string | null; // FN10: the receipt photo, attached online once the expense is on the server
};
export type TransferDto = { id: string; day: string; amountCentimes: string; fromId: string; toId: string };
/**
 * FN13's batch result as text, for a screen (SPEC-finance §9 "One cost per kg"): the batch report, the batch screen's
 * closing card and /compare all read this one, so their cost per kg is /results'. Money: never sent to workers.
 */
export type BatchResultDto = {
  id: string;
  salesCentimes: string;
  costCentimes: string;
  marginCentimes: string;
  soldGrams: number;
  costPerKgCentimes: string | null;
  marginPerKgCentimes: string | null;
  marginPermille: string | null;
};

export const FINANCE_MUTATIONS = {
  createTreasuryAccount: "finance.createTreasuryAccount",
  recordExpense: "finance.recordExpense",
  recordTransfer: "finance.recordTransfer",
} as const;
