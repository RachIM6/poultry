"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { saveLegalIds } from "@/modules/farm-registry";
import { changeAccountingChoices } from "@/modules/finance";
import { getWriteContext } from "@/modules/identity";

export type SaveState = { ok?: boolean; messageKey?: string };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2).
export async function saveAccountingAction(_: SaveState, form: FormData): Promise<SaveState> {
  const ctx = await getWriteContext(await headers());
  if (!ctx.ok) return { messageKey: `errors.${ctx.error}` };
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

/** F-Profile: the entity's registration numbers; farm-registry checks finance.manage and the ICE's 15 digits. */
export async function saveLegalIdsAction(_: SaveState, form: FormData): Promise<SaveState> {
  const ctx = await getWriteContext(await headers());
  if (!ctx.ok) return { messageKey: `errors.${ctx.error}` };
  const f = Object.fromEntries(form);
  const saved = await saveLegalIds(ctx.value, String(f.legalEntityId), { ice: f.ice, fiscalId: f.fiscalId, rcNumber: f.rcNumber, rcCourt: f.rcCourt, cnssNumber: f.cnssNumber });
  if (!saved.ok) return { messageKey: saved.error === "INVALID_INPUT" ? "LegalIds.invalid" : `errors.${saved.error}` };
  refresh();
  return { ok: true, messageKey: "LegalIds.saved" };
}
