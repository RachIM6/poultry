"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { saveScheduleAction } from "./actions";
import { OfflineHint, useOnline } from "@/components/online";
import { danger, secondary } from "@/components/ui";

const input = "w-28 min-h-11 rounded-lg border border-muted bg-card px-2 text-end";

/**
 * FN13 (§9 "Laying hens in the batch result"): a laying flock's laying period and cull value, never prefilled before
 * they are typed; the batch result then depreciates its hens. Online.
 */
export function ScheduleForm({ batchId, flock, life, cull }: { batchId: string; flock: string; life: string; cull: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(saveScheduleAction, {});
  const online = useOnline();
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-3">
      <input type="hidden" name="batchId" value={batchId} />
      <label className="flex flex-col gap-1 text-sm">
        {t("Results.schedule.life")}
        <input key={`life:${life}`} name="life" defaultValue={life} required inputMode="numeric" dir="ltr" aria-label={t("Results.schedule.lifeOf", { flock })} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("Results.schedule.cull")}
        <input key={`cull:${cull}`} name="cull" defaultValue={cull} required inputMode="decimal" dir="ltr" aria-label={t("Results.schedule.cullOf", { flock })} className={input} />
      </label>
      <button type="submit" disabled={pending || !online} className={secondary}>{t("Results.schedule.save")}</button>
      <OfflineHint online={online} />
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? "w-full" : `w-full ${danger}`}>{t(state.messageKey)}</p>}
    </form>
  );
}
