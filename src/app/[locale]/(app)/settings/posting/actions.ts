"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { setPostingOverride } from "@/modules/finance";
import { getWriteContext } from "@/modules/identity";

export type SaveState = { ok?: boolean; messageKey?: string };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2).
export async function saveOverrideAction(_: SaveState, form: FormData): Promise<SaveState> {
  const ctx = await getWriteContext(await headers());
  if (!ctx.ok) return { messageKey: `errors.${ctx.error}` };
  const account = String(form.get("account") ?? "");
  const saved = await setPostingOverride(ctx.value, { ruleAccount: String(form.get("ruleAccount") ?? ""), account: account || null });
  if (!saved.ok) return { messageKey: `errors.${saved.error}` };
  refresh();
  return { ok: true, messageKey: "Overrides.saved" };
}
