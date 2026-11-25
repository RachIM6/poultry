"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { saveBudget } from "@/modules/finance";
import { getWriteContext } from "@/modules/identity";

export type SaveState = { ok?: boolean; messageKey?: string };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2).
export async function saveBudgetAction(_: SaveState, form: FormData): Promise<SaveState> {
  const ctx = await getWriteContext(await headers());
  if (!ctx.ok) return { messageKey: `errors.${ctx.error}` };
  const fields = Object.fromEntries(form);
  const saved = await saveBudget(ctx.value, { ...fields, basedOn: fields.basedOn || null, batchId: fields.batchId || null, saleDay: fields.saleDay || null, chickPaymentDays: fields.chickPaymentDays || null, feedPaymentDays: fields.feedPaymentDays || null });
  if (!saved.ok) return { messageKey: `errors.${saved.error}` };
  refresh();
  return { ok: true, messageKey: "Budget.savedOk" };
}
