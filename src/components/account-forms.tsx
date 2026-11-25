"use client";

import type { Payload } from "altcha-lib";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { postJson, rememberSignedIn } from "@/lib/api";
import { CaptchaField } from "@/components/captcha-field";
import { danger, field, primary } from "@/components/ui";

// ADR-015: create an account (an owner, or someone joining with an invite code) and set a new password with a reset
// code. The server checks everything again; the confirmation is only checked here.

const label = "font-semibold";

function PasswordFields() {
  const t = useTranslations("Account");
  return (
    <>
      <label htmlFor="password" className={label}>{t("passwordLabel")}</label>
      <input id="password" name="password" type="password" autoComplete="new-password" dir="ltr" required minLength={10} maxLength={128} aria-describedby="password-hint" className={field} />
      <p id="password-hint" className="text-sm text-muted">{t("passwordHint")}</p>
      <label htmlFor="confirm" className={label}>{t("confirmLabel")}</label>
      <input id="confirm" name="confirm" type="password" autoComplete="new-password" dir="ltr" required maxLength={128} className={field} />
    </>
  );
}

function CodeField({ hint }: { hint: string }) {
  const t = useTranslations("Account");
  return (
    <>
      <label htmlFor="code" className={label}>{t("codeLabel")}</label>
      <input id="code" name="code" type="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} dir="ltr" required maxLength={16} placeholder="ABCD-EFGH" aria-describedby="code-hint" className={`${field} tracking-widest`} />
      <p id="code-hint" className="text-sm text-muted">{hint}</p>
    </>
  );
}

/** One submit at a time; the captcha payload is single use, so every answer asks for a new one. */
function useSubmit(url: string, always: boolean, body: (form: FormData) => Record<string, unknown>) {
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<Payload>();
  const [captchaKey, setCaptchaKey] = useState(0);
  const [needsCaptcha, setNeedsCaptcha] = useState(always);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get("password") !== form.get("confirm")) return setError("errors.PASSWORDS_DIFFER");
    setBusy(true);
    setError(undefined);
    const res = await postJson(url, { ...body(form), password: form.get("password"), locale, captcha });
    // No organisation yet: nothing to remember, the dashboard sends to onboarding.
    if (res.status === 200 || res.status === 201) return rememberSignedIn().then(() => router.replace("/dashboard"));
    setError(res.messageKey);
    if (res.messageKey === "errors.CAPTCHA_REQUIRED") setNeedsCaptcha(true);
    setCaptcha(undefined);
    setCaptchaKey((n) => n + 1);
    setBusy(false);
  };
  const captchaField = needsCaptcha && <CaptchaField key={captchaKey} onSolved={setCaptcha} />;
  return { submit, error, disabled: busy || (needsCaptcha && !captcha), captchaField };
}

/** A new account with a phone and/or an email. `invite`: the person joins an organisation with the owner's code. */
export function SignupForm({ invite = false }: { invite?: boolean }) {
  const t = useTranslations();
  const { submit, error, disabled, captchaField } = useSubmit("/api/auth/sign-up", true, (form) => ({
    phone: form.get("phone"),
    email: form.get("email"),
    inviteCode: invite ? form.get("code") : undefined,
  }));
  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      {invite && <CodeField hint={t("Account.inviteCodeHint")} />}
      <label htmlFor="phone" className={label}>{t("Account.phoneLabel")}</label>
      <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="06 12 34 56 78" aria-describedby="phone-hint" className={field} />
      <p id="phone-hint" className="text-sm text-muted">{t("Account.phoneHint")}</p>
      <label htmlFor="email" className={label}>{t("Account.emailLabel")}</label>
      <input id="email" name="email" type="email" inputMode="email" autoComplete="email" dir="ltr" maxLength={254} aria-describedby="email-hint" className={field} />
      <p id="email-hint" className="text-sm text-muted">{t("Account.emailHint")}</p>
      <PasswordFields />
      {captchaField}
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <button type="submit" disabled={disabled} className={`${primary} mt-4`}>{t(invite ? "Account.join" : "Account.create")}</button>
    </form>
  );
}

/** A new password with the reset code the owner (or the operator) gave. Every other device is signed out. */
export function ResetForm() {
  const t = useTranslations();
  const { submit, error, disabled, captchaField } = useSubmit("/api/auth/reset-password", false, (form) => ({
    identifier: form.get("identifier"),
    code: form.get("code"),
  }));
  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <label htmlFor="identifier" className={label}>{t("Login.identifierLabel")}</label>
      <input id="identifier" name="identifier" type="text" autoComplete="username" dir="ltr" required placeholder="06 12 34 56 78" className={field} />
      <CodeField hint={t("Account.resetCodeHint")} />
      <PasswordFields />
      {captchaField}
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <button type="submit" disabled={disabled} className={`${primary} mt-4`}>{t("Account.setPassword")}</button>
    </form>
  );
}
