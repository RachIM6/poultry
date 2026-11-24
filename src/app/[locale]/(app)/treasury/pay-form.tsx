"use client";

import { useTranslations } from "next-intl";
import { useActionState, type ReactNode } from "react";
import { secondary } from "@/components/ui";
import { payPlacementAction } from "./actions";

/** A placement's payment: the server-rendered fields, sent to the server action (§9 placement debts). */
export function PlacementPayForm({ submit, children }: { submit: string; children: ReactNode }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(payPlacementAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      {children}
      {state.messageKey && <p role={state.ok ? "status" : "alert"}>{t(state.messageKey)}</p>}
      <button type="submit" disabled={pending} className={secondary}>{submit}</button>
    </form>
  );
}
