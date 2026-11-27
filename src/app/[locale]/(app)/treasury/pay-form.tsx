"use client";

import { useTranslations } from "next-intl";
import { createContext, useActionState, useContext, useState, type ReactNode } from "react";
import { OfflineHint, useOnline } from "@/components/online";
import { useCloseSheet } from "@/components/sheet";
import { danger, done, primary } from "@/components/ui";
import type { TreasuryFormState } from "./actions";

// A saved form's message, shown on the page: the sheet that held the form closes once it has saved.
const Saved = createContext<{ key?: string; set: (key: string) => void }>({ set: () => {} });

/** Around the whole page, its header actions included: where a sheet's form says it has saved. */
export function TreasuryNotices({ children }: { children: ReactNode }) {
  const [key, set] = useState<string>();
  return <Saved value={{ key, set }}>{children}</Saved>;
}

/** « Paiement enregistré. » once a sheet's form has saved and closed. */
export function TreasuryNotice() {
  const t = useTranslations();
  const { key } = useContext(Saved);
  return key ? <p role="status" className={done}>{t(key)}</p> : null;
}

/**
 * One of /treasury's forms: the server-rendered fields, sent to its server action (§9 placement debts, credit expenses).
 * In a sheet, it closes the sheet once saved. submitLabel: the button's accessible name when its text alone doesn't say
 * what it acts on (WCAG 2.4.6).
 */
export function TreasuryForm({ action: send, submit, submitLabel, look = primary, children }: { action: (state: TreasuryFormState, form: FormData) => Promise<TreasuryFormState>; submit: string; submitLabel?: string; look?: string; children: ReactNode }) {
  const t = useTranslations();
  const close = useCloseSheet();
  const saved = useContext(Saved).set;
  const [state, action, pending] = useActionState(async (before: TreasuryFormState, form: FormData) => {
    const after = await send(before, form);
    if (after.ok) {
      if (after.messageKey) saved(after.messageKey);
      close(); // outside a sheet: nothing
    }
    return after;
  }, {});
  const online = useOnline();
  return (
    <form action={action} className="flex flex-col gap-3">
      {children}
      {state.messageKey && !state.ok && <p role="alert" className={danger}>{t(state.messageKey)}</p>}
      <OfflineHint online={online} />
      <button type="submit" aria-label={submitLabel} disabled={pending || !online} className={look}>{submit}</button>
    </form>
  );
}
