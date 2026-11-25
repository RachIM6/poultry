import type { Line } from "@/modules/finance/domain/entry";
import type { Posting } from "@/modules/finance/domain/posting";

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
  bank_fees: "61473", // Frais et commissions sur services bancaires (FC9, T119; 6147 is subdivided, FN4: CGNC scan p. 293)
} as const;
export type ExpenseCategory = keyof typeof EXPENSE_ACCOUNTS;
export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_ACCOUNTS) as ExpenseCategory[];

/** FC9 (T119): the bank takes its fees from one of its accounts, so they are paid from that bank account only. */
export const bankOnly = (category: string) => category === "bank_fees";

/** How an expense is paid: from a cash box, from a bank account, or owed to a supplier (credit). */
export const PAID_FROM = ["cash", "bank", "credit"] as const;
export type PaidFrom = (typeof PAID_FROM)[number];

/**
 * FN6: where money paid out leaves from, by payment method, and in which journal: the cash box, or the bank (an issued
 * cheque leaves the bank on its issue day). Each payment adds its own credit method (a supplier, a bill, an asset debt).
 * Here, not in posting.ts: prisma/seed.ts loads this file under plain Node (VAT_RECOVERABLE below).
 */
export const PAID_WITH = {
  cash: { account: "5161", journal: "CA" },
  transfer: { account: "5141", journal: "BQ" },
  cheque: { account: "5141", journal: "BQ" },
} as const satisfies Record<string, { account: string; journal: Posting["journal"] }>;

const SOURCE: Record<PaidFrom, { account: string; journal: Posting["journal"] }> = {
  cash: PAID_WITH.cash,
  bank: PAID_WITH.transfer,
  credit: { account: "4411", journal: "AC" },
};

export type TaggedLine = Line;

// FN9: the VAT on charges. The PCA nomenclature lists 3455 "Etat - TVA récupérable" undivided (p. 60), but the CGNC splits
// it (scan p. 279), so a line goes on a leaf (FN4): 34552 sur les charges here, 34551 sur immobilisations for an asset
// (FC1). Defined here, not in posting.ts: prisma/seed.ts loads this file under plain node, where only type imports of
// other files work.
export const VAT_RECOVERABLE = "34552"; // État – TVA récupérable sur les charges

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

/** FN3: the kind of treasury account a line on `account` names (5141 a bank account, 5161 a cash box), or null. */
export const treasuryKindOfAccount = (account: string): TreasuryKind | null => TREASURY_KINDS.find((k) => ACCOUNT[k] === account) ?? null;

/**
 * SPEC-finance §9 "Default cash box and bank account": a 5141 / 5161 line that names no bank account or cash box goes on
 * the organisation's default one of that kind, when it has one (a sale, a purchase, a payment or wages "en espèces" or
 * "par banque" record no account). A line that names one keeps it.
 */
export const onDefaultTreasury = (lines: readonly Line[], defaults: Partial<Record<TreasuryKind, string>>): Line[] =>
  lines.map((l) => {
    const kind = treasuryKindOfAccount(l.account);
    const id = kind && !l.treasuryId ? defaults[kind] : undefined;
    return id ? { ...l, treasuryId: id } : l;
  });
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
