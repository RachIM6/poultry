"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { saveLayerSchedule } from "@/modules/finance";
import { getWriteContext } from "@/modules/identity";

export type ScheduleState = { ok?: boolean; messageKey?: string };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2).
/** FN13 (§9 "Laying hens in the batch result"): a laying flock's laying period in months and cull value in dirhams. */
export async function saveScheduleAction(_: ScheduleState, form: FormData): Promise<ScheduleState> {
  const ctx = await getWriteContext(await headers());
  if (!ctx.ok) return { messageKey: `errors.${ctx.error}` };
  const saved = await saveLayerSchedule(ctx.value, { batchId: form.get("batchId"), life: String(form.get("life") ?? ""), cull: String(form.get("cull") ?? "") });
  if (!saved.ok) return { messageKey: `errors.${saved.error}` };
  refresh();
  return { ok: true, messageKey: "Results.schedule.saved" };
}
