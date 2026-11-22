"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { parseCentimes } from "@/lib/kernel/money";
import { postManualEntry } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

export type PostState = { ok?: boolean; messageKey?: string; month?: string };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2). The receipt goes up
// afterwards through /api/files, never in this body.
export async function postManualEntryAction(form: FormData): Promise<PostState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const text = (k: string) => form.getAll(k).map((v) => String(v).trim());
  const [accounts, debits, credits] = [text("account"), text("debit"), text("credit")];
  const lines = [];
  for (const [i, account] of accounts.entries()) {
    if (!account && !debits[i] && !credits[i]) continue; // a row left empty
    const [debit, credit] = [debits[i], credits[i]].map((a) => (a ? parseCentimes(a) : 0n));
    if (debit === null || credit === null) return { messageKey: "errors.INVALID_INPUT" };
    lines.push({ account, debit: String(debit), credit: String(credit) });
  }
  const day = String(form.get("day") ?? "");
  const posted = await postManualEntry(ctx.value, { id: form.get("id"), day, label: form.get("label"), piece: form.get("piece"), lines });
  if (!posted.ok) return { messageKey: `errors.${posted.error}` };
  refresh();
  return { ok: true, messageKey: "Books.manualPosted", month: day.slice(0, 7) };
}
