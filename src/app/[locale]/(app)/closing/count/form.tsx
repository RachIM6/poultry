"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { saveCountAction } from "./actions";
import { primary, secondary } from "@/components/ui";

/** SPEC-finance FC3: the server-rendered sheet inside a form; the owner and managers save what was counted. */
export function CountForm({ year, write, children }: { year: number; write: boolean; children: React.ReactNode }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(saveCountAction, {});
  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="year" value={year} />
      {children}
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className="print:hidden">{t(state.messageKey)}</p>}
      {write && <button type="submit" disabled={pending} className={`${primary} print:hidden`}>{t("Count.save")}</button>}
    </form>
  );
}

export function PrintButton() {
  const t = useTranslations("Count");
  return <button type="button" onClick={() => window.print()} className={`${secondary} print:hidden`}>{t("print")}</button>;
}
