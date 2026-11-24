"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { changeAccountingChoices } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

export type SaveState = { ok?: boolean; messageKey?: string };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2).
export async function saveAccountingAction(_: SaveState, form: FormData): Promise<SaveState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const f = Object.fromEntries(form);
  const saved = await changeAccountingChoices(ctx.value, String(f.legalEntityId), {
    books: f.books,
    pcaOverlay: f.chart === "pca",
    fiscalYearStartMonth: Number(f.month),
    vatRegistered: f.vatRegistered === "on",
    hensMethod: f.hensMethod,
    allocationKey: f.allocationKey,
  });
  if (!saved.ok) return { messageKey: `errors.${saved.error}` };
  refresh();
  return { ok: true, messageKey: "Accounting.saved" };
}
