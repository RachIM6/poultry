"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { runClose } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

export type CloseState = { ok?: boolean; messageKey?: string; posted?: number };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2).
export async function runCloseAction(_: CloseState, form: FormData): Promise<CloseState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const run = await runClose(ctx.value, { year: Number(form.get("year")) });
  if (!run.ok) return { messageKey: `errors.${run.error}` };
  refresh();
  return run.value === 0 ? { ok: true, messageKey: "Close.nothingPosted" } : { ok: true, messageKey: "Close.posted", posted: run.value };
}
