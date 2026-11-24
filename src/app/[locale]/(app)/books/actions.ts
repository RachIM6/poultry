"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { parseCentimes } from "@/lib/kernel/money";
import { listLegalEntities } from "@/modules/farm-registry";
import { postManualEntry, reverseEntry, setPeriodLocked } from "@/modules/finance";
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
    lines.push({ account, debit: String(debit), credit: String(credit), treasuryId: form.get(`treasury-${i}`) || null }); // FN3: on 5141 / 5161
  }
  const day = String(form.get("day") ?? "");
  const posted = await postManualEntry(ctx.value, { id: form.get("id"), day, label: form.get("label"), piece: form.get("piece"), lines });
  if (!posted.ok) return { messageKey: `errors.${posted.error}` };
  refresh();
  return { ok: true, messageKey: "Books.manualPosted", month: day.slice(0, 7) };
}

/** FN5, FCX3: the owner cancels a manual entry ("Annuler l'écriture"); the reversal is the server's. */
export async function reverseEntryAction(_: PostState, form: FormData): Promise<PostState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const reversed = await reverseEntry(ctx.value, String(form.get("entryId") ?? ""));
  if (!reversed.ok) return { messageKey: `errors.${reversed.error}` };
  refresh();
  return { ok: true, messageKey: "Books.reversed" };
}

/** FN5: the owner locks (`locked` = 1) or unlocks a month of the books. */
export async function periodLockAction(_: PostState, form: FormData): Promise<PostState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const [entity] = await listLegalEntities(ctx.value); // ponytail: one legal entity per organisation in M1
  if (!entity) return { messageKey: "errors.NOT_FOUND" };
  const locked = form.get("locked") === "1";
  const done = await setPeriodLocked(ctx.value, entity.id, String(form.get("month") ?? ""), locked);
  if (!done.ok) return { messageKey: `errors.${done.error}` };
  refresh();
  return { ok: true, messageKey: locked ? "Books.monthLockedDone" : "Books.monthUnlockedDone" };
}
