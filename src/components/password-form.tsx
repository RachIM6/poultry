"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { changeMyPassword } from "@/app/[locale]/(app)/organizations/actions";
import { OfflineHint, unsent, useOnline } from "@/components/online";
import { danger, field, secondary } from "@/components/ui";
import { postJson } from "@/lib/api";

type State = { messageKey?: string; saved?: true };
const label = "font-semibold";

// A change forgets every device's pushes (identity changePassword): this one sends its existing subscription again.
// Best effort and silent; never subscribe(), which would prompt.
async function keepThisDevicesPushes() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || Notification.permission !== "granted") return;
    // getRegistration, not ready: ready never settles without a service worker, and the form would hang.
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
    if (sub) await postJson("/api/push/subscribe", sub.toJSON());
  } catch {}
}

/**
 * « Informations personnelles »: a new password, with the current one (identity changePassword checks it all again).
 * Online only. The form empties after every answer: no password stays in the page.
 */
export function PasswordForm() {
  const t = useTranslations();
  const online = useOnline();
  const [state, action, pending] = useActionState(async (_: State, form: FormData): Promise<State> => {
    if (form.get("newPassword") !== form.get("confirmPassword")) return { messageKey: "errors.PASSWORDS_DIFFER" };
    const result = await unsent(changeMyPassword(form));
    if (result.saved) await keepThisDevicesPushes();
    return result;
  }, {});
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <label htmlFor="currentPassword" className={label}>{t("Account.currentPasswordLabel")}</label>
      <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" dir="ltr" required maxLength={128} className={field} />
      <label htmlFor="newPassword" className={label}>{t("Account.newPasswordLabel")}</label>
      <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" dir="ltr" required minLength={10} maxLength={128} aria-describedby="newPassword-hint" className={field} />
      <p id="newPassword-hint" className="text-sm text-muted">{t("Account.passwordHint")}</p>
      <label htmlFor="confirmPassword" className={label}>{t("Account.confirmNewPasswordLabel")}</label>
      <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" dir="ltr" required maxLength={128} className={field} />
      {state.messageKey && (
        <p role={state.saved ? "status" : "alert"} className={state.saved ? "text-olive" : danger}>
          {t(state.messageKey)}
        </p>
      )}
      <OfflineHint online={online} />
      <button type="submit" disabled={pending || !online} className={secondary}>{t("Account.changePassword")}</button>
    </form>
  );
}
