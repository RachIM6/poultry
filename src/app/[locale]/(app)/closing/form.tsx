"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { fiscalYearAction, openYearAction, runCloseAction, saveHensAction, saveValuesAction } from "./actions";
import { OfflineHint, useOnline } from "@/components/online";
import { danger, primary, secondary } from "@/components/ui";

/** SPEC-finance FCX4: the owner posts what the preview shows (again: FN7 posts only what changed); disabled while the month is locked. */
export function CloseForm({ year, disabled }: { year: number; disabled: boolean }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(runCloseAction, {});
  const online = useOnline();
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="year" value={year} />
      <OfflineHint online={online} />
      <button type="submit" disabled={disabled || pending || !online} className={primary}>{t("Close.run")}</button>
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{t(state.messageKey, { count: state.posted ?? 0 })}</p>}
    </form>
  );
}

/** SPEC-finance FC5, FQ20: the server-rendered stock lines inside a form; the owner saves the current values typed. */
export function ValuesForm({ year, write, children }: { year: number; write: boolean; children: React.ReactNode }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(saveValuesAction, {});
  const online = useOnline();
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="year" value={year} />
      {children}
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{t(state.messageKey)}</p>}
      {write && <OfflineHint online={online} />}
      {write && <button type="submit" disabled={pending || !online} className={secondary}>{t("Close.saveValues")}</button>}
    </form>
  );
}

/** SPEC-finance FC6 (T115): the laying flocks inside a form; the owner saves each one's life and cull value. */
export function HensForm({ year, write, children }: { year: number; write: boolean; children: React.ReactNode }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(saveHensAction, {});
  const online = useOnline();
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="year" value={year} />
      {children}
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{t(state.messageKey)}</p>}
      {write && <OfflineHint online={online} />}
      {write && <button type="submit" disabled={pending || !online} className={secondary}>{t("Close.saveHens")}</button>}
    </form>
  );
}

/** SPEC-finance FCX6: the owner closes the year (the server refuses it while the run has something to post), or reopens it. */
export function YearForm({ year, closed, hint }: { year: number; closed: boolean; hint: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(fiscalYearAction, {});
  const online = useOnline();
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="year" value={year} />
      {closed && <input type="hidden" name="reopen" value="1" />}
      <p className="text-sm text-ink-2">{hint}</p>
      <OfflineHint online={online} />
      <button type="submit" disabled={pending || !online} className={closed ? secondary : primary}>{t(closed ? "Close.reopen" : "Close.closeYear")}</button>
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{t(state.messageKey, { count: state.posted ?? 0 })}</p>}
    </form>
  );
}

/** SPEC-finance FN3: the owner opens the year from the previous one as it stands, until that one is closed. */
export function OpenYearForm({ year, label, hint }: { year: number; label: string; hint: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(openYearAction, {});
  const online = useOnline();
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="year" value={year} />
      <p className="text-sm text-ink-2">{hint}</p>
      <OfflineHint online={online} />
      <button type="submit" disabled={pending || !online} className={secondary}>{label}</button>
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{t(state.messageKey, { count: state.posted ?? 0 })}</p>}
    </form>
  );
}
