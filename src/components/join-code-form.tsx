"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { joinWithCode } from "@/app/[locale]/(app)/organizations/actions";
import { danger, field, primary } from "@/components/ui";

/** ADR-015: a signed-in person joins an organisation with the owner's invite code; it opens that organisation. */
export function JoinCodeForm() {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState(joinWithCode, {});
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <input type="hidden" name="locale" value={locale} />
      <label htmlFor="invite-code" className="font-semibold">{t("Account.codeLabel")}</label>
      <input id="invite-code" name="code" type="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} dir="ltr" required maxLength={16} placeholder="ABCD-EFGH" aria-describedby="invite-code-hint" className={`${field} tracking-widest`} />
      <p id="invite-code-hint" className="text-sm text-muted">{t("Account.inviteCodeHint")}</p>
      {state.messageKey && <p role="alert" className={danger}>{t(state.messageKey)}</p>}
      <button type="submit" disabled={pending} className={primary}>{t("Account.join")}</button>
    </form>
  );
}
