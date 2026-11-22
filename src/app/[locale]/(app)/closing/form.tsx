"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { runCloseAction } from "./actions";
import { primary } from "@/components/ui";

/** SPEC-finance FCX4: the owner posts what the preview shows (again: FN7 posts only what changed); disabled while the month is locked. */
export function CloseForm({ year, disabled }: { year: number; disabled: boolean }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(runCloseAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="year" value={year} />
      <button type="submit" disabled={disabled || pending} className={primary}>{t("Close.run")}</button>
      {state.messageKey && <p role={state.ok ? "status" : "alert"}>{t(state.messageKey, { count: state.posted ?? 0 })}</p>}
    </form>
  );
}
