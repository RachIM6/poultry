"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { parseCentimes } from "@/lib/kernel/money";
import { confirmLoan, createLoan, createSubsidy, discardLoan, payLoanInstallment, saveLoanSchedule } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

export type LoanState = { ok?: boolean; messageKey?: string };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2).
const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const whole = (form: FormData, key: string) => {
  const v = text(form, key);
  return v === null ? null : Number(v); // not a whole number: INVALID_INPUT
};
/** "5,55" (a percentage, at most 3 decimals) → 5 550, in 1/100 000; null when it isn't one. Digits only, no float (FX1). */
const rate = (form: FormData) => {
  const m = /^(\d{1,3})(?:[.,](\d{1,3}))?$/.exec((text(form, "rate") ?? "").replace(/\s/g, ""));
  return m ? Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0")) : null;
};
const centimes = (form: FormData, key: string) => {
  const c = parseCentimes(text(form, key) ?? "");
  return c === null ? null : String(c);
};

type Ctx = Parameters<typeof createLoan>[0];
async function run(write: (ctx: Ctx) => Promise<{ ok: boolean; error?: string }>, done: string): Promise<LoanState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const result = await write(ctx.value);
  if (!result.ok) return { messageKey: `errors.${result.error}` };
  refresh();
  return { ok: true, messageKey: done };
}

export async function createLoanAction(form: FormData): Promise<LoanState> {
  const opening = form.get("opening") === "on";
  const loan = {
    id: form.get("id"),
    lender: form.get("lender"),
    treasuryId: text(form, "treasuryId"),
    principalCentimes: centimes(form, "principal"),
    disbursedOn: opening ? null : form.get("disbursedOn"),
    rate: rate(form),
    frequency: form.get("frequency"),
    installments: whole(form, "installments"),
    deferral: whole(form, "deferral") ?? 0,
    firstDueOn: form.get("firstDueOn"),
  };
  return run((ctx) => createLoan(ctx, loan), "Loans.created");
}

/** The draft's rows as typed (`capital-<n>`, `interest-<n>`), saved; then confirmed when that button sent the form. */
export async function scheduleAction(form: FormData): Promise<LoanState> {
  const loanId = form.get("loanId");
  const numbers = form.getAll("number").map(Number);
  const rows = numbers.map((n) => ({ number: n, capitalCentimes: centimes(form, `capital-${n}`), interestCentimes: centimes(form, `interest-${n}`) }));
  if (rows.some((r) => r.capitalCentimes === null || r.interestCentimes === null)) return { messageKey: "errors.INVALID_INPUT" };
  const confirm = form.get("intent") === "confirm";
  return run(async (ctx) => {
    const saved = await saveLoanSchedule(ctx, { loanId, rows });
    return saved.ok && confirm ? confirmLoan(ctx, { loanId }) : saved;
  }, confirm ? "Loans.confirmed" : "Loans.rowsSaved");
}

export async function payInstallmentAction(_: LoanState, form: FormData): Promise<LoanState> {
  return run((ctx) => payLoanInstallment(ctx, { loanId: form.get("loanId"), number: whole(form, "number"), day: form.get("day") }), "Loans.paid");
}

export async function discardLoanAction(_: LoanState, form: FormData): Promise<LoanState> {
  return run((ctx) => discardLoan(ctx, { loanId: form.get("loanId") }), "Loans.discarded");
}

/** FC2 (T106): a subsidy as received, with the assets it finances (the checked boxes). */
export async function createSubsidyAction(form: FormData): Promise<LoanState> {
  const subsidy = {
    id: form.get("id"),
    label: form.get("label"),
    grantor: form.get("grantor"),
    amountCentimes: centimes(form, "amount"),
    receivedOn: form.get("receivedOn"),
    treasuryId: text(form, "treasuryId"),
    assetIds: form.getAll("assetId"),
  };
  return run((ctx) => createSubsidy(ctx, subsidy), "Subsidies.created");
}
