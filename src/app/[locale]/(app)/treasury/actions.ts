"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { parseCentimes } from "@/lib/kernel/money";
import type { TenantContext } from "@/lib/tenant";
import { payCreditExpense, payPlacement } from "@/modules/finance";
import { getTenantContext, limitSignedIn } from "@/modules/identity";

export type TreasuryFormState = { ok?: boolean; messageKey?: string };

/** A payment form's fields, the signed-in context checked and rate-limited first; the amount in centimes. */
async function paymentFrom(form: FormData): Promise<{ failed: TreasuryFormState } | { ctx: TenantContext; fields: Record<string, unknown> }> {
  const h = await headers();
  const ctx = await getTenantContext(h);
  if (!ctx.ok) return { failed: { messageKey: "errors.UNAUTHENTICATED" } };
  if (await limitSignedIn("authenticated", h, ctx.value.userId)) return { failed: { messageKey: "errors.TOO_MANY_REQUESTS" } }; // rate-limiting.md §3 default
  const amount = parseCentimes(String(form.get("amount") ?? "").trim());
  if (amount === null) return { failed: { messageKey: "errors.INVALID_INPUT" } };
  const treasuryId = form.get("treasuryId");
  const fields = { id: form.get("id"), day: form.get("day"), amountCentimes: String(amount), paidWith: form.get("paidWith"), treasuryId: typeof treasuryId === "string" && treasuryId ? treasuryId : null };
  return { ctx: ctx.value, fields };
}

const outcome = (r: { ok: true } | { ok: false; error: string }): TreasuryFormState => {
  if (!r.ok) return { messageKey: `errors.${r.error}` };
  refresh();
  return { ok: true, messageKey: "Treasury.paid" };
};

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2).
export async function payPlacementAction(_: TreasuryFormState, form: FormData): Promise<TreasuryFormState> {
  const p = await paymentFrom(form);
  return "failed" in p ? p.failed : outcome(await payPlacement(p.ctx, { ...p.fields, batchId: form.get("batchId") }));
}

export async function payCreditExpenseAction(_: TreasuryFormState, form: FormData): Promise<TreasuryFormState> {
  const p = await paymentFrom(form);
  return "failed" in p ? p.failed : outcome(await payCreditExpense(p.ctx, { ...p.fields, expenseId: form.get("expenseId") }));
}
