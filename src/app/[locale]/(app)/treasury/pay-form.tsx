"use client";

import { useTranslations } from "next-intl";
import { useActionState, type ReactNode } from "react";
import { danger, secondary } from "@/components/ui";
import type { TreasuryFormState } from "./actions";

/** One of /treasury's forms: the server-rendered fields, sent to its server action (§9 placement debts, credit expenses). */
export function TreasuryForm({ action: send, submit, children }: { action: (state: TreasuryFormState, form: FormData) => Promise<TreasuryFormState>; submit: string; children: ReactNode }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(send, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      {children}
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{t(state.messageKey)}</p>}
      <button type="submit" disabled={pending} className={secondary}>{submit}</button>
    </form>
  );
}
