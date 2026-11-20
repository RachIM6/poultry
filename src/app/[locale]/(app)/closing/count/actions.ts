"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { saveYearEndCount } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

export type SaveState = { ok?: boolean; messageKey?: string };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2).
export async function saveCountAction(_: SaveState, form: FormData): Promise<SaveState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const counts = Object.fromEntries([...form].flatMap(([k, v]) => (k.startsWith("count:") ? [[k.slice(6), String(v)]] : [])));
  const saved = await saveYearEndCount(ctx.value, { year: Number(form.get("year")), counts });
  if (!saved.ok) return { messageKey: `errors.${saved.error}` };
  refresh();
  return { ok: true, messageKey: "Count.saved" };
}
