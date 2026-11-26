"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { saveLegalIdsAction } from "./actions";
import { OfflineHint, useOnline } from "@/components/online";
import { formActions, sectionTitle } from "@/components/layout";
import { card, danger, field, secondary } from "@/components/ui";
import type { LegalIds } from "@/modules/farm-registry/schema";

/** F-Profile: the owner's registration numbers (ICE, IF, RC, CNSS), shown on the statements' header. Never locked. Its
 * save is a secondary: the choices' save below is the page's one primary. */
export function LegalIdsForm({ legalEntityId, ids }: { legalEntityId: string; ids: LegalIds | null }) {
  const t = useTranslations("LegalIds");
  const tAll = useTranslations();
  const [state, action, pending] = useActionState(saveLegalIdsAction, {});
  const online = useOnline();
  const title = useId();
  const input = (name: keyof LegalIds, max: number, extra?: object) => (
    <label className="flex flex-col gap-1">
      <span className="font-medium">{t(name)}</span>
      <input name={name} defaultValue={ids?.[name] ?? ""} maxLength={max} dir="ltr" autoComplete="off" className={field} {...extra} />
    </label>
  );
  return (
    <form action={action} aria-labelledby={title} className={`${card} gap-4`}>
      <h2 id={title} className={sectionTitle}>{t("title")}</h2>
      <p className="text-sm text-ink-2">{t("hint")}</p>
      <input type="hidden" name="legalEntityId" value={legalEntityId} />
      {/* Wide screens: the five numbers three by three, their fields on one line whatever their label's length */}
      <div className="grid gap-4 sm:grid-cols-2 sm:items-end lg:grid-cols-3 lg:gap-x-6">
        {/* 15 digits; spaces allowed as typed, the server drops them */}
        {input("ice", 20, { inputMode: "numeric", pattern: String.raw`\s*(\d\s*){15}` })}
        {input("fiscalId", 20)}
        {input("cnssNumber", 20)}
        {input("rcNumber", 20)}
        {input("rcCourt", 60)}
      </div>
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{tAll(state.messageKey)}</p>}
      <OfflineHint online={online} />
      <div className={formActions}>
        <button type="submit" disabled={pending || !online} className={secondary}>{t("save")}</button>
      </div>
    </form>
  );
}
