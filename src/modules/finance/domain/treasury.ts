import type { Line } from "@/modules/finance/domain/entry";
import { VAT_RECOVERABLE, type Posting } from "@/modules/finance/domain/posting";

// SPEC-finance FN3, FN6, FX4. Pure: the phone checks an expense with the same code as the server.

export const TREASURY_KINDS = ["bank", "cash"] as const; // sub-accounts of 5141 and 5161, as a tag on the lines (FN3)
export type TreasuryKind = (typeof TREASURY_KINDS)[number];

/** FN6 quick expenses, with the PCA account each one is charged to (the entity's chart maps it, FN2). */
export const EXPENSE_ACCOUNTS = {
  electricity: "612512", // Consommation d'électricité
  water: "612511", // Consommation d'eau
  vet_fees: "6136", // Rémunérations d'intermédiaires et honoraires
  insurance: "6134", // Primes d'assurances
  catching: "612612", // Travaux et façons, productions animales: catching crew or transport of the birds
} as const;
export type ExpenseCategory = keyof typeof EXPENSE_ACCOUNTS;
export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_ACCOUNTS) as ExpenseCategory[];

/** How an expense is paid: from a cash box, from a bank account, or owed to a supplier (credit). */
export const PAID_FROM = ["cash", "bank", "credit"] as const;
export type PaidFrom = (typeof PAID_FROM)[number];

const SOURCE: Record<PaidFrom, { account: string; journal: Posting["journal"] }> = {
  cash: { account: "5161", journal: "CA" },
  bank: { account: "5141", journal: "BQ" },
  credit: { account: "4411", journal: "AC" },
};

export type TaggedLine = Line;

/** FN6: a quick expense, D its charge / C the cash box, the bank or the supplier. FN9: a registered entity's VAT apart. */
export function expensePosting(
  e: { category: ExpenseCategory; amount: bigint; paidFrom: PaidFrom; treasuryId: string | null; vat?: bigint },
  vatRegistered = false,
): Posting & { lines: TaggedLine[] } {
  const from = SOURCE[e.paidFrom];
  const vat = vatRegistered ? (e.vat ?? 0n) : 0n;
  return {
    journal: from.journal,
    label: "Dépense",
    lines: [
      { account: EXPENSE_ACCOUNTS[e.category], debit: e.amount - vat, credit: 0n },
      ...(vat > 0n ? [{ account: VAT_RECOVERABLE, debit: vat, credit: 0n }] : []),
      { account: from.account, debit: 0n, credit: e.amount, treasuryId: e.paidFrom === "credit" ? null : e.treasuryId },
    ],
  };
}

const ACCOUNT: Record<TreasuryKind, string> = { bank: "5141", cash: "5161" };
const JOURNAL: Record<TreasuryKind, Posting["journal"]> = { bank: "BQ", cash: "CA" };
const IN_TRANSIT = "5115"; // Virements de fonds

/**
 * FN6: money moved between two treasury accounts goes through 5115 in two entries, one in each account's journal:
 * D 5115 / C the source, then D the destination / C 5115.
 */
export function transferPostings(t: { amount: bigint; from: { id: string; kind: TreasuryKind }; to: { id: string; kind: TreasuryKind } }): [Posting, Posting] {
  return [
    { journal: JOURNAL[t.from.kind], label: "Virement de fonds", lines: [{ account: IN_TRANSIT, debit: t.amount, credit: 0n }, { account: ACCOUNT[t.from.kind], debit: 0n, credit: t.amount, treasuryId: t.from.id } as TaggedLine] },
    { journal: JOURNAL[t.to.kind], label: "Virement de fonds", lines: [{ account: ACCOUNT[t.to.kind], debit: t.amount, credit: 0n, treasuryId: t.to.id } as TaggedLine, { account: IN_TRANSIT, debit: 0n, credit: t.amount }] },
  ];
}
