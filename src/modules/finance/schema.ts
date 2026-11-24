import { z } from "zod";
import { CSV_DATE_FORMATS, CSV_SEPARATORS, EXPENSE_CATEGORIES, PAID_FROM, TREASURY_KINDS } from "./shared.ts";

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

/** SPEC-finance §9 "Cancelled records": a quick expense cancelled. Corrected: RecordExpense again, with its id. */
export const CancelExpense = z.object({ expenseId: z.uuid() });

/** FC9: a bank statement as printed: its account, last day and closing balance (integer centimes, negative when overdrawn). */
export const AddBankStatement = z.object({ treasuryId: z.uuid(), endDay: z.iso.date(), closingCentimes: z.string().regex(/^-?\d{1,15}$/) });

const column = z.int().min(1).max(100); // as the owner counts them, from 1

/**
 * FC9, T117: a statement file for one bank account, MT940 or a CSV export read with the owner's mapping (a signed amount
 * column, or a debit and a credit column), with the end day and closing balance the owner reads on it. `dryRun`: the
 * preview, nothing saved.
 */
export const ImportBankFile = z.object({
  treasuryId: z.uuid(),
  format: z.enum(["mt940", "csv"]),
  fileName: z.string().max(255),
  bytes: z.instanceof(Uint8Array),
  csv: z
    .object({
      mapping: z
        .object({
          separator: z.enum(CSV_SEPARATORS),
          skipLines: z.int().min(0).max(50),
          dateColumn: column,
          dateFormat: z.enum(CSV_DATE_FORMATS),
          labelColumn: column,
          amountColumn: column.nullable(),
          debitColumn: column.nullable(),
          creditColumn: column.nullable(),
          decimalComma: z.boolean(),
        })
        .refine((m) => (m.amountColumn === null) === (m.debitColumn !== null && m.creditColumn !== null), "a signed amount column, or a debit and a credit column"),
      endDay: z.iso.date(),
      closingCentimes: z.string().regex(/^-?\d{1,15}$/),
    })
    .nullable(),
  dryRun: z.boolean(),
}).refine((x) => (x.format === "csv") === (x.csv !== null), "the CSV mapping goes with a CSV file only");

/** FC9: ticking (or unticking) a 5141 line on a statement. */
export const BankMatchInput = z.object({ statementId: z.uuid(), lineId: z.uuid(), ticked: z.boolean() });

/** FN6: money moved from one treasury account to another (cash deposited, cash withdrawn). */
export const RecordTransfer = z.object({ id: z.uuid(), day: z.iso.date(), amountCentimes: positive, fromId: z.uuid(), toId: z.uuid() });

/** FCX3: an entry the owner types (OD). Its id comes from the form, so a retry posts nothing twice. FN4 checks the lines. */
export const ManualEntryInput = z.object({
  id: z.uuid(),
  day: z.iso.date(),
  label: z.string().trim().min(1).max(200),
  piece: z.string().trim().max(40).transform((x) => x || null).nullable().default(null),
  // treasuryId: the bank account (5141) or cash box (5161) the line moves, FN3; none on other accounts
  lines: z.array(z.object({ account: z.string().trim().regex(/^[1-8]\d{0,7}$/), debit: centimes, credit: centimes, treasuryId: z.uuid().nullable().default(null) })).max(200),
});

// FC1 (T102), the owner's asset register. The category and the rules between fields are checked by
// domain/assets.ts (not imported here: prisma/seed.ts loads this file under plain Node).
const lifeMonths = z.int().min(0).max(1200).nullable(); // 0 or none: LIFE_REQUIRED, unless land
const treasuryId = z.uuid().nullable().default(null);

/** FC1: an asset acquired, or in the opening balance (`opening`, then no payment). Its id comes from the form. */
export const FixedAssetInput = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(120),
  category: z.string().max(40),
  farmId: z.uuid().nullable().default(null),
  houseId: z.uuid().nullable().default(null),
  acquiredOn: z.iso.date(),
  inServiceOn: z.iso.date(),
  amountCentimes: positive, // the invoice total
  vatCentimes: centimes.default("0"), // FN9: part of the total
  residualCentimes: centimes.default("0"),
  lifeMonths,
  paidWith: z.enum(["cash", "transfer", "cheque", "credit"]).nullable(),
  treasuryId,
  opening: z.object({ on: z.iso.date(), accumulatedCentimes: centimes }).nullable().default(null),
});

/** FC1: what may change once the acquisition is posted: the depreciation isn't posted before the close run (T103). */
export const FixedAssetUpdate = z.object({ assetId: z.uuid(), lifeMonths, residualCentimes: centimes });

/** FC1: a later payment of an asset bought on credit. Its id comes from the form, so a retry posts once. */
export const FixedAssetPayment = z.object({ id: z.uuid(), assetId: z.uuid(), day: z.iso.date(), amountCentimes: positive, paidWith: z.enum(["cash", "transfer", "cheque"]), treasuryId });

/** §9 "Placement debts": a payment of a placement's chicks or point-of-lay hens (FN6, FC6). Its id comes from the form. */
export const PlacementPayment = z.object({ id: z.uuid(), batchId: z.uuid(), day: z.iso.date(), amountCentimes: positive, paidWith: z.enum(["cash", "transfer", "cheque"]), treasuryId });

/** §9 "Credit expenses": a payment of a quick expense recorded on credit (FN6). Its id comes from the form. */
export const CreditExpensePayment = z.object({ id: z.uuid(), expenseId: z.uuid(), day: z.iso.date(), amountCentimes: positive, paidWith: z.enum(["cash", "transfer", "cheque"]), treasuryId });

/** §9 "Associate contributions": money an associate or the exploitant brings in or takes out (FN6, FQ11). Its id comes from the form. */
export const AssociateMovement = z.object({
  id: z.uuid(),
  day: z.iso.date(),
  direction: z.enum(["contribution", "withdrawal"]),
  amountCentimes: positive,
  treasuryId: z.uuid(), // the cash box or bank account the money goes into or leaves
  associate: z.string().trim().max(80).transform((x) => x || null).nullable().default(null),
});

/** FC1: sold or scrapped (price 0), the price received in cash or at the bank. */
export const FixedAssetDisposal = z.object({ assetId: z.uuid(), day: z.iso.date(), priceCentimes: centimes, receivedIn: z.enum(["cash", "bank"]), treasuryId });

// FC2 (T105), the owner's loans. The rules between fields are checked by domain/loans.ts.
/**
 * FC2: a loan from its contract. The rate is annual, in 1/100 000 (5,55 % → 5 550). No disbursement day: taken before
 * Dawra, in the opening balance (FCX3), the principal then being the capital still owed. Its id comes from the form.
 */
export const LoanInput = z.object({
  id: z.uuid(),
  lender: z.string().trim().min(1).max(120),
  treasuryId: z.uuid(), // the bank account it is paid into, and the installments leave
  principalCentimes: positive,
  disbursedOn: z.iso.date().nullable(),
  rate: z.int().min(0).max(100_000),
  frequency: z.enum(["monthly", "quarterly"]),
  installments: z.int().min(1).max(600),
  deferral: z.int().min(0).max(120).default(0),
  firstDueOn: z.iso.date(),
});

/** FC2: the rows adjusted to the bank's table, before confirming: every row of the draft, by number. */
export const LoanScheduleInput = z.object({
  loanId: z.uuid(),
  rows: z.array(z.object({ number: z.int().min(1), capitalCentimes: centimes, interestCentimes: centimes })).min(1).max(720),
});

export const LoanRef = z.object({ loanId: z.uuid() });

/** FC2: an installment the bank debited, on its day (default: the due day). */
export const LoanPayment = z.object({ loanId: z.uuid(), number: z.int().min(1), day: z.iso.date() });

// FC2 (T106), the owner's investment subsidies. The rules between fields are checked by domain/subsidies.ts.
/** FC2: a subsidy as received (default FQ17), on a bank account, and the register's assets it finances. Its id comes from the form. */
export const SubsidyInput = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(120),
  grantor: z.string().trim().min(1).max(120),
  amountCentimes: positive,
  receivedOn: z.iso.date(),
  treasuryId: z.uuid(),
  assetIds: z.array(z.uuid()).max(50).refine((ids) => new Set(ids).size === ids.length),
});
