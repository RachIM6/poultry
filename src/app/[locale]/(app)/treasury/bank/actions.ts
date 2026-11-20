"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseCentimes } from "@/lib/kernel/money";
import { addBankStatement, matchBankLine } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

export type BankState = { messageKey?: string };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2).
export async function addStatementAction(_: BankState, form: FormData): Promise<BankState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const text = String(form.get("closing") ?? "").trim();
  const closing = parseCentimes(text.replace(/^-/, "")); // as printed; a leading "-" when overdrawn
  if (closing === null) return { messageKey: "errors.INVALID_INPUT" };
  const treasuryId = String(form.get("treasuryId"));
  const added = await addBankStatement(ctx.value, { treasuryId, endDay: form.get("endDay"), closingCentimes: String(text.startsWith("-") ? -closing : closing) });
  if (!added.ok) return { messageKey: `errors.${added.error}` };
  const locale = form.get("locale") === "ar" ? "ar" : "fr";
  redirect(`/${locale}/treasury/bank?${new URLSearchParams({ account: treasuryId, statement: added.value })}`);
}

/** One form for the statement's lines: the pressed button names the line ("tick" or "untick"). */
export async function matchAction(_: BankState, form: FormData): Promise<BankState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const tick = form.get("tick");
  const matched = await matchBankLine(ctx.value, { statementId: form.get("statementId"), lineId: tick ?? form.get("untick"), ticked: tick !== null });
  if (!matched.ok) return { messageKey: `errors.${matched.error}` };
  refresh();
  return {};
}
