// What the phone's screens need from finance, without Zod (ADR-009). Relative imports only: prisma/seed.ts loads
// ./schema.ts, which re-exports this file, under plain Node.
export { EXPENSE_ACCOUNTS, EXPENSE_CATEGORIES, PAID_FROM, TREASURY_KINDS } from "./domain/treasury.ts";
export type { ExpenseCategory, PaidFrom, TreasuryKind } from "./domain/treasury.ts";
export { breakEvenPrice, budgetOf } from "./domain/budget.ts";
export type { Budget, BudgetInputs } from "./domain/budget.ts";

export type TreasuryAccountDto = { id: string; kind: "bank" | "cash"; name: string };
/** FX4: a quick expense, recorded on the phone. Money: never sent to workers (FX2). */
export type ExpenseDto = {
  id: string;
  day: string; // farm day
  category: "electricity" | "water" | "vet_fees" | "insurance" | "catching";
  amountCentimes: string;
  paidFrom: "cash" | "bank" | "credit";
  treasuryId: string | null;
  note: string | null;
  // FN13, FN14: one batch's direct charge, or shared over a month's batches by bird-days; neither: general.
  batchId?: string | null;
  serviceMonth?: string | null; // "2026-10": a shared expense's service period (default: the month of its day)
};
export type TransferDto = { id: string; day: string; amountCentimes: string; fromId: string; toId: string };

export const FINANCE_MUTATIONS = {
  createTreasuryAccount: "finance.createTreasuryAccount",
  recordExpense: "finance.recordExpense",
  recordTransfer: "finance.recordTransfer",
} as const;
