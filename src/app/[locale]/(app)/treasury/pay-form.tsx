"use client";

import { useTranslations } from "next-intl";
import { useActionState, type ReactNode } from "react";
import { OfflineHint, useOnline } from "@/components/online";
import { danger, secondary } from "@/components/ui";
import type { TreasuryFormState } from "./actions";

/**
 * One of /treasury's forms: the server-rendered fields, sent to its server action (§9 placement debts, credit expenses).
 * submitLabel: the button's accessible name when its text alone doesn't say what it acts on (WCAG 2.4.6).
 */
export function TreasuryForm({ action: send, submit, submitLabel, children }: { action: (state: TreasuryFormState, form: FormData) => Promise<TreasuryFormState>; submit: string; submitLabel?: string; children: ReactNode }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(send, {});
  const online = useOnline();
  return (
    <form action={action} className="flex flex-col gap-3">
      {children}
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{t(state.messageKey)}</p>}
      <OfflineHint online={online} />
      <button type="submit" aria-label={submitLabel} disabled={pending || !online} className={secondary}>{submit}</button>
    </form>
  );
}
