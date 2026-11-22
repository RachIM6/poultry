import { v7 as uuidv7 } from "uuid";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities, type LegalEntityDto } from "@/modules/farm-registry";
import { notify } from "@/modules/notifications";
import { postEntry, type PostError } from "@/modules/finance/application/ledger";
import { chartOf } from "@/modules/finance/domain/chart";
import { checkLoan, checkSchedule, disbursementPosting, installmentPosting, loanSchedule, type LoanError, type LoanFrequency } from "@/modules/finance/domain/loans";
import { inChart, type Posting } from "@/modules/finance/domain/posting";
import { ledgerAccounts } from "@/modules/finance/infrastructure/ledger";
import { LoanInput, LoanPayment, LoanRef, LoanScheduleInput } from "@/modules/finance/schema";
import type { Loan, LoanInstallment } from "@/generated/prisma/client";

export type LoanWriteError = LoanError | PostError | "DAY_IN_FUTURE" | "LOAN_CONFIRMED" | "LOAN_NOT_CONFIRMED" | "BEFORE_DUE_DAY";

const date = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10) as FarmDay;
const inFuture = (day: string, clock: Clock) => daysBetween(day as FarmDay, nextFarmDay(farmDayOf(clock.now()))) < 0;
const disbursementSource = (id: string) => `loan:${id}:disbursement`;
const installmentSource = (id: string, number: number) => `loan:${id}:installment:${number}`;

/**
 * Posts a rule's entry in the entity's chart (PCA off → FN2's CGNC accounts), dated by its author: a locked month
 * refuses it. Unlike an asset's (FCX4, FQ27), a `cash_book` entity posts it too: the money moves on its bank account,
 * so the disbursement, the installments and a subsidy's receipt (T106) show in its cash book (FN16).
 */
export async function post(tx: Tx, ctx: TenantContext, entity: LegalEntityDto, source: string, day: FarmDay, rule: Posting): Promise<Result<void, PostError>> {
  const all = await ledgerAccounts(tx);
  const posting = inChart(rule, chartOf(all, "cgnc", ["pca"]), chartOf(all, entity.accountingProfile.base, entity.accountingProfile.overlays));
  if (!posting) throw new Error(`${source}: an account has no home in this chart`); // a rule bug: accounts.test.ts
  return postEntry(tx, ctx, { id: uuidv7(), legalEntityId: entity.id, journal: posting.journal, day, label: posting.label, reversesId: null, lines: posting.lines, source: { module: "finance", id: source, version: 1 } });
}

const lockLoan = async (tx: Tx, ctx: TenantContext, id: string) => {
  await tx.$executeRaw`SELECT 1 FROM "Loan" WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
  return tx.loan.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { rows: { orderBy: { number: "asc" } } } });
};

/**
 * SPEC-finance FC2: the owner types a loan from its contract; its schedule is computed (§7 `loanSchedule`, FQ16) and
 * kept as a draft the owner adjusts to the bank's table before confirming. Nothing is posted yet. The id comes from
 * the form: the same form twice creates one loan.
 */
export async function createLoan(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<void, LoanWriteError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = LoanInput.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const l = parsed.data;
  if (l.disbursedOn && inFuture(l.disbursedOn, clock)) return fail("DAY_IN_FUTURE");
  const checked = checkLoan(l.disbursedOn as FarmDay | null, l.firstDueOn as FarmDay);
  if (!checked.ok) return checked;
  const principal = BigInt(l.principalCentimes);
  const rows = loanSchedule({ principal, rate: l.rate, frequency: l.frequency, installments: l.installments, deferral: l.deferral, firstDueOn: l.firstDueOn as FarmDay });
  const valid = checkSchedule(principal, rows); // a principal of a few centimes over many rows: the last one below zero
  if (!valid.ok) return valid;
  const [entity] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation in M1 (onboarding)
  if (!entity) return fail("NOT_FOUND");
  return db.$transaction(async (tx): Promise<Result<void, LoanWriteError>> => {
    const prior = await tx.loan.findUnique({ where: { id: l.id }, select: { organizationId: true } });
    if (prior) return prior.organizationId === ctx.organizationId ? ok(undefined) : fail("ALREADY_EXISTS"); // a retry
    const bank = await tx.treasuryAccount.findFirst({ where: { id: l.treasuryId, organizationId: ctx.organizationId }, select: { kind: true } });
    if (!bank) return fail("NOT_FOUND");
    if (bank.kind !== "bank") return fail("INVALID_INPUT"); // FC2: paid into a bank account (5141)
    await tx.loan.create({
      data: {
        id: l.id,
        organizationId: ctx.organizationId,
        legalEntityId: entity.id,
        lender: l.lender,
        treasuryId: l.treasuryId,
        principalCentimes: principal,
        disbursedOn: l.disbursedOn && date(l.disbursedOn),
        rate: l.rate,
        frequency: l.frequency,
        installments: l.installments,
        deferral: l.deferral,
        firstDueOn: date(l.firstDueOn),
        createdBy: ctx.userId,
        rows: { create: rows.map((r) => ({ number: r.number, organizationId: ctx.organizationId, dueOn: date(r.dueOn), capitalCentimes: r.capital, interestCentimes: r.interest })) },
      },
    });
    await audit(tx, ctx, { entity: "Loan", entityId: l.id, action: "create", after: l });
    return ok(undefined);
  });
}

/** FC2: before confirming, the owner changes any row's capital and interest to match the bank's table to the centime. */
export async function saveLoanSchedule(ctx: TenantContext, input: unknown): Promise<Result<void, LoanWriteError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = LoanScheduleInput.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { loanId, rows } = parsed.data;
  return db.$transaction(async (tx): Promise<Result<void, LoanWriteError>> => {
    const loan = await lockLoan(tx, ctx, loanId);
    if (!loan) return fail("NOT_FOUND");
    if (loan.confirmedAt) return fail("LOAN_CONFIRMED"); // confirmed rows are fixed
    const numbers = new Set(rows.map((r) => r.number));
    if (numbers.size !== loan.rows.length || loan.rows.some((r) => !numbers.has(r.number))) return fail("INVALID_INPUT");
    for (const r of rows) {
      await tx.loanInstallment.update({ where: { loanId_number: { loanId, number: r.number } }, data: { capitalCentimes: BigInt(r.capitalCentimes), interestCentimes: BigInt(r.interestCentimes) } });
    }
    const amounts = (xs: { number: number; capitalCentimes: bigint | string; interestCentimes: bigint | string }[]) => xs.map((r) => [r.number, String(r.capitalCentimes), String(r.interestCentimes)]);
    await audit(tx, ctx, { entity: "Loan", entityId: loanId, action: "update", before: { rows: amounts(loan.rows) }, after: { rows: amounts(rows) } });
    return ok(undefined);
  });
}

/**
 * FC2: the owner confirms the schedule; its capital must add up to the principal. Its rows are then fixed, and the
 * disbursement is posted on its day, D 5141 / C 1481 (source `loan:<id>:disbursement`). A loan in the opening balance
 * posts nothing: its capital still owed comes with the opening entry (FCX3). Confirming again changes nothing.
 */
export async function confirmLoan(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<void, LoanWriteError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = LoanRef.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const [entity] = await listLegalEntities(ctx);
  if (!entity) return fail("NOT_FOUND");
  return db.$transaction(async (tx): Promise<Result<void, LoanWriteError>> => {
    const loan = await lockLoan(tx, ctx, parsed.data.loanId);
    if (!loan) return fail("NOT_FOUND");
    if (loan.confirmedAt) return ok(undefined); // a retry
    const checked = checkSchedule(loan.principalCentimes, loan.rows.map((r) => ({ capital: r.capitalCentimes, interest: r.interestCentimes })));
    if (!checked.ok) return checked;
    if (loan.disbursedOn) {
      const posted = await post(tx, ctx, entity, disbursementSource(loan.id), dayOf(loan.disbursedOn), disbursementPosting(loan.lender, loan.principalCentimes, loan.treasuryId));
      if (!posted.ok) return posted; // nothing written yet
    }
    await tx.loan.update({ where: { id: loan.id }, data: { confirmedAt: clock.now() } });
    await audit(tx, ctx, { entity: "Loan", entityId: loan.id, action: "confirm" });
    return ok(undefined);
  });
}

/** FC2: a draft typed wrong (a principal, a rate) is thrown away by the owner; a confirmed loan stays. */
export async function discardLoan(ctx: TenantContext, input: unknown): Promise<Result<void, LoanWriteError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = LoanRef.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  return db.$transaction(async (tx): Promise<Result<void, LoanWriteError>> => {
    const loan = await lockLoan(tx, ctx, parsed.data.loanId);
    if (!loan) return ok(undefined); // already gone
    if (loan.confirmedAt) return fail("LOAN_CONFIRMED");
    await tx.loan.delete({ where: { id: loan.id } }); // its rows with it
    await audit(tx, ctx, { entity: "Loan", entityId: loan.id, action: "delete", before: { lender: loan.lender, principalCentimes: String(loan.principalCentimes) } });
    return ok(undefined);
  });
}

/**
 * FC2: the owner or a manager marks an installment paid, on the day the bank debited it, on or after its due day (as
 * "Débité" in FN11). Posts D 1481 capital, D 6311 interest / C 5141 (source `loan:<id>:installment:<number>`). The whole
 * installment only: a partial payment is out of scope. Marking it again posts nothing.
 */
export async function payLoanInstallment(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<void, LoanWriteError>> {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  const parsed = LoanPayment.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { loanId, number } = parsed.data;
  const day = parsed.data.day as FarmDay;
  if (inFuture(day, clock)) return fail("DAY_IN_FUTURE");
  const [entity] = await listLegalEntities(ctx);
  if (!entity) return fail("NOT_FOUND");
  return db.$transaction(async (tx): Promise<Result<void, LoanWriteError>> => {
    const loan = await lockLoan(tx, ctx, loanId); // two marks at once: one after the other
    const row = loan?.rows.find((r) => r.number === number);
    if (!loan || !row) return fail("NOT_FOUND");
    if (!loan.confirmedAt) return fail("LOAN_NOT_CONFIRMED");
    if (row.paidOn) return ok(undefined); // already paid: posted once
    if (day < dayOf(row.dueOn)) return fail("BEFORE_DUE_DAY");
    const rule = installmentPosting(loan.lender, { number, capital: row.capitalCentimes, interest: row.interestCentimes }, loan.treasuryId);
    if (rule) {
      const posted = await post(tx, ctx, entity, installmentSource(loan.id, number), day, rule);
      if (!posted.ok) return posted; // nothing written yet
    }
    await tx.loanInstallment.update({ where: { loanId_number: { loanId, number } }, data: { paidOn: date(day) } });
    await audit(tx, ctx, { entity: "LoanInstallment", entityId: loanId, action: "pay", after: { number, day } });
    return ok(undefined);
  });
}

/** FC2, F-Effects: the installments of confirmed loans not yet paid, outflows on their due day for the cash schedule. */
export async function loanInstallmentsDue(ctx: TenantContext): Promise<{ dueOn: string; amountCentimes: bigint }[]> {
  const rows = await db.loanInstallment.findMany({
    where: { organizationId: ctx.organizationId, paidOn: null, loan: { confirmedAt: { not: null } } },
    select: { dueOn: true, capitalCentimes: true, interestCentimes: true },
  });
  return rows.map((r) => ({ dueOn: dayOf(r.dueOn), amountCentimes: r.capitalCentimes + r.interestCentimes }));
}

// Not a member: the scheduler acts for each organisation only to notify its members (no audit, no farm data written).
const SCHEDULER = "00000000-0000-0000-0000-000000000000";

/**
 * FC2, from the host's scheduler (with the push dispatch): each installment of a confirmed loan is announced once,
 * from the start of its due day, to the owners and managers, unless already paid. A money notification: never to a
 * worker or the accountant. Not urgent: quiet hours hold it (N2).
 */
export async function sendLoanReminders(clock: Clock = systemClock): Promise<number> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ organizationId: string; lender: string; number: number; amountCentimes: bigint }[]>`
      UPDATE "LoanInstallment" i SET "remindedAt" = ${clock.now()}
      FROM "Loan" l
      WHERE l.id = i."loanId" AND l."confirmedAt" IS NOT NULL AND i."dueOn" = ${farmDayOf(clock.now())}::date
        AND i."remindedAt" IS NULL AND i."paidOn" IS NULL
      RETURNING i."organizationId", l.lender, i.number, i."capitalCentimes" + i."interestCentimes" AS "amountCentimes"`;
    for (const r of rows) {
      await notify(
        tx,
        { organizationId: r.organizationId, userId: SCHEDULER, role: "owner" },
        { roles: ["owner", "manager"], templateKey: "loanDue", params: { lender: r.lender, number: String(r.number), amount: formatMoney(r.amountCentimes) }, urgency: "normal" },
        clock,
      );
    }
    return rows.length;
  });
}

export type LoanRowView = { number: number; dueOn: FarmDay; outstandingBefore: bigint; capital: bigint; interest: bigint; paidOn: FarmDay | null };
export type LoanView = {
  id: string;
  lender: string;
  bank: string; // the bank account's name
  principal: bigint;
  rate: number;
  frequency: LoanFrequency;
  installments: number;
  deferral: number;
  disbursedOn: FarmDay | null; // null: in the opening balance
  firstDueOn: FarmDay;
  confirmed: boolean;
  owed: bigint; // the capital still owed: the principal less the capital of the rows paid
  rows: LoanRowView[];
};
export type LoanRegister = { books: "cash_book" | "ledger"; loans: LoanView[]; banks: { id: string; name: string }[] };

const viewOf = (l: Loan & { rows: LoanInstallment[] }, banks: Map<string, string>): LoanView => {
  let outstanding = l.principalCentimes;
  const rows = l.rows.map((r): LoanRowView => {
    const row = { number: r.number, dueOn: dayOf(r.dueOn), outstandingBefore: outstanding, capital: r.capitalCentimes, interest: r.interestCentimes, paidOn: r.paidOn && dayOf(r.paidOn) };
    outstanding -= r.capitalCentimes;
    return row;
  });
  return {
    id: l.id,
    lender: l.lender,
    bank: banks.get(l.treasuryId) ?? "—",
    principal: l.principalCentimes,
    rate: l.rate,
    frequency: l.frequency as LoanFrequency,
    installments: l.installments,
    deferral: l.deferral,
    disbursedOn: l.disbursedOn && dayOf(l.disbursedOn),
    firstDueOn: dayOf(l.firstDueOn),
    confirmed: l.confirmedAt !== null,
    owed: l.principalCentimes - l.rows.filter((r) => r.paidOn).reduce((s, r) => s + r.capitalCentimes, 0n),
    rows,
  };
};

/** FC2 "Emprunts et subventions": each loan's schedule with its paid and due installments. A read: the accountant too. */
export async function loanRegister(ctx: TenantContext): Promise<Result<LoanRegister, "FORBIDDEN" | "NOT_FOUND">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN"); // workers never see money (FX2)
  const [entity] = await listLegalEntities(ctx);
  if (!entity) return fail("NOT_FOUND");
  const org = { organizationId: ctx.organizationId };
  const [loans, banks] = await Promise.all([
    db.loan.findMany({ where: { ...org, legalEntityId: entity.id }, include: { rows: { orderBy: { number: "asc" } } }, orderBy: [{ firstDueOn: "asc" }, { lender: "asc" }] }),
    db.treasuryAccount.findMany({ where: { ...org, kind: "bank" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const names = new Map(banks.map((b) => [b.id, b.name]));
  return ok({ books: entity.accountingProfile.books, loans: loans.map((l) => viewOf(l, names)), banks });
}
