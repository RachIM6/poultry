"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { closeFiscalYear, openFiscalYear, reopenFiscalYear, runClose, saveHensSchedules, saveYearEndValues } from "@/modules/finance";
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

/** FC5, FQ20: the owner's current values of the stock lines (`value:<item>`); an empty one puts the line back at cost. */
export async function saveValuesAction(_: CloseState, form: FormData): Promise<CloseState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const values = Object.fromEntries([...form].flatMap(([k, v]) => (k.startsWith("value:") ? [[k.slice(6), String(v)]] : [])));
  const saved = await saveYearEndValues(ctx.value, { year: Number(form.get("year")), values });
  if (!saved.ok) return { messageKey: `errors.${saved.error}` };
  refresh();
  return { ok: true, messageKey: "Close.valuesSaved" };
}

/** FC6 (T115): each laying flock's life in months (`life:<batch>`) and cull value in dirhams (`cull:<batch>`). */
export async function saveHensAction(_: CloseState, form: FormData): Promise<CloseState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const values: Record<string, { life: string; cull: string }> = {};
  for (const [k, v] of form) {
    const [field, id] = k.split(":");
    if ((field === "life" || field === "cull") && id) values[id] = { ...(values[id] ?? { life: "", cull: "" }), [field]: String(v) };
  }
  const saved = await saveHensSchedules(ctx.value, { year: Number(form.get("year")), values });
  if (!saved.ok) return { messageKey: `errors.${saved.error}` };
  refresh();
  return { ok: true, messageKey: "Close.hensSaved" };
}

/** FCX6: closes the fiscal year (locks it, posts the next year's opening), or reopens it (`reopen`: its last month). */
export async function fiscalYearAction(_: CloseState, form: FormData): Promise<CloseState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const input = { year: Number(form.get("year")) };
  if (form.get("reopen")) {
    const reopened = await reopenFiscalYear(ctx.value, input);
    if (!reopened.ok) return { messageKey: `errors.${reopened.error}` };
    refresh();
    return { ok: true, messageKey: "Close.reopened" };
  }
  const closed = await closeFiscalYear(ctx.value, input);
  if (!closed.ok) return { messageKey: `errors.${closed.error}` };
  refresh();
  return { ok: true, messageKey: "Close.yearClosed", posted: closed.value };
}

/** FN3: opens the fiscal year with its à-nouveaux before the previous year is closed (again: only what changed, FN7). */
export async function openYearAction(_: CloseState, form: FormData): Promise<CloseState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const opened = await openFiscalYear(ctx.value, { year: Number(form.get("year")) });
  if (!opened.ok) return { messageKey: `errors.${opened.error}` };
  refresh();
  return opened.value === 0 ? { ok: true, messageKey: "Close.nothingPosted" } : { ok: true, messageKey: "Close.opened", posted: opened.value };
}
