"use client";

import { useTranslations } from "next-intl";
import { useActionState, type ReactNode } from "react";
import { joinWithCode } from "@/app/[locale]/(app)/organizations/actions";
import { danger, field, primary } from "@/components/ui";
import { useRouter } from "@/i18n/navigation";
import { rememberSignedIn } from "@/lib/api";

/** ADR-015: a signed-in person joins an organisation with the owner's invite code; it opens that organisation. */
export function JoinCodeForm() {
  const t = useTranslations();
  const router = useRouter();
  const [state, action, pending] = useActionState(async (previous: { messageKey?: string }, form: FormData) => {
    const result = await joinWithCode(previous, form);
    if (result.opened) {
      await rememberSignedIn();
      router.replace("/dashboard");
    }
    return result;
  }, {});
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <label htmlFor="invite-code" className="font-semibold">{t("Account.codeLabel")}</label>
      <input id="invite-code" name="code" type="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} dir="ltr" required maxLength={16} placeholder="ABCD-EFGH" aria-describedby="invite-code-hint" className={`${field} tracking-widest`} />
      <p id="invite-code-hint" className="text-sm text-muted">{t("Account.inviteCodeHint")}</p>
      {state.messageKey && <p role="alert" className={danger}>{t(state.messageKey)}</p>}
      <button type="submit" disabled={pending} className={primary}>{t("Account.join")}</button>
    </form>
  );
}

/** SPEC-m5 PA2: opens another farm (openFarm, acceptAndOpen), remembers it on the phone, then shows its dashboard. */
export function OpenFarmForm({ action, className, children }: { action: (form: FormData) => Promise<boolean>; className?: string; children: ReactNode }) {
  const router = useRouter();
  const open = async (form: FormData) => {
    if (!(await action(form))) return;
    await rememberSignedIn();
    router.replace("/dashboard");
  };
  return (
    <form action={open} className={className}>
      {children}
    </form>
  );
}
