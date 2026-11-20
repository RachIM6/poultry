import { z } from "zod";
import { EXPENSE_CATEGORIES, PAID_FROM, TREASURY_KINDS } from "./shared.ts";

export * from "./shared.ts";

// ADR-010 §2. Also imported by prisma/seed.ts under plain Node: no "@/" imports here.
export const CHARTS = ["cgnc", "pca", "coop"] as const; // no "coop" account is seeded until FQ2 gives its list: nothing posts
export type Chart = (typeof CHARTS)[number];

export const AccountRow = z.object({
  chart: z.enum(CHARTS),
  number: z.string().regex(/^[1-8]\d{0,7}$/),
  label: z.string().trim().min(1).max(200), // French, as printed in the source (Arabic labels: FQ12)
  parent: z.string().regex(/^[1-8]\d{0,7}$/).nullable(),
  // An overlay account's base-chart account, used when the overlay is off (SPEC-finance FN2's "CGNC parent" column).
  // Not always the tree parent: 612123 sits under 61212 → 6121 in the PCA, but posts to 6122 without it.
  fallback: z.string().regex(/^[1-8]\d{0,7}$/).nullable().default(null),
});
export type AccountRow = z.infer<typeof AccountRow>;

/** prisma/seed/finance/accounts.json: every account cites its source document (ADR-010: no number is invented). */
export const AccountsFile = z
  .object({ sources: z.partialRecord(z.enum(CHARTS), z.string().min(1)), accounts: z.array(AccountRow).min(1) })
  .refine((f) => f.accounts.every((a) => f.sources[a.chart]), "every chart used needs its source");

const centimes = z.string().regex(/^\d{1,15}$/); // integer centimes; JSON has no bigint
const positive = centimes.refine((c) => BigInt(c) > 0n, "must be above zero");
const note = z.string().trim().max(200).transform((x) => x || null).nullable();

/** FN3: a bank account or cash box of the organisation. */
export const CreateTreasuryAccount = z.object({ id: z.uuid(), kind: z.enum(TREASURY_KINDS), name: z.string().trim().min(1).max(80) });

/** FX4: a quick expense from the phone. `treasuryId`: the bank account or cash box it was paid from, if known. */
export const RecordExpense = z.object({
  id: z.uuid(),
  day: z.iso.date(),
  category: z.enum(EXPENSE_CATEGORIES as [string, ...string[]]),
  amountCentimes: positive,
  vatCentimes: centimes.default("0"), // SPEC-finance FN9: the bill's VAT, part of the total
  paidFrom: z.enum(PAID_FROM),
  treasuryId: z.uuid().nullable(),
  note,
  batchId: z.uuid().nullable().default(null),
  serviceMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().default(null),
});

/** FC9: a bank statement as printed: its account, last day and closing balance (integer centimes, negative when overdrawn). */
export const AddBankStatement = z.object({ treasuryId: z.uuid(), endDay: z.iso.date(), closingCentimes: z.string().regex(/^-?\d{1,15}$/) });

/** FC9: ticking (or unticking) a 5141 line on a statement. */
export const BankMatchInput = z.object({ statementId: z.uuid(), lineId: z.uuid(), ticked: z.boolean() });

/** FN6: money moved from one treasury account to another (cash deposited, cash withdrawn). */
export const RecordTransfer = z.object({ id: z.uuid(), day: z.iso.date(), amountCentimes: positive, fromId: z.uuid(), toId: z.uuid() });
