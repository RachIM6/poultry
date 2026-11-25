"use client";

import type { Payload } from "altcha-lib";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { postJson, rememberSignedIn } from "@/lib/api";
import { CaptchaField } from "@/components/captcha-field";
import { danger, primary } from "@/components/ui";

const big = "h-[60px] rounded-2xl border-2 border-ink bg-card px-4 text-[22px] font-medium text-ink placeholder:text-muted";

/** ADR-015: the phone or the email, and the password. After 3 failures the server asks for a captcha (as verify-code). */
export function PasswordLoginForm() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<Payload>();
  const [captchaKey, setCaptchaKey] = useState(0);
  const [needsCaptcha, setNeedsCaptcha] = useState(false);

  // Read from the form, not kept in state while typing: on a slow phone they can be typed before React hydrates.
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(e.currentTarget);
    const res = await postJson("/api/auth/sign-in", { identifier: form.get("identifier"), password: form.get("password"), locale, captcha });
    if (res.status === 200) return rememberSignedIn().then(() => router.replace("/dashboard"));
    setError(res.messageKey);
    if (res.messageKey === "errors.CAPTCHA_REQUIRED") setNeedsCaptcha(true);
    setCaptcha(undefined); // single use: a new one for the next try
    setCaptchaKey((n) => n + 1);
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <label htmlFor="identifier" className="text-lg font-semibold">{t("Login.identifierLabel")}</label>
      <input id="identifier" name="identifier" type="text" autoComplete="username" dir="ltr" required aria-describedby="identifier-hint" placeholder="06 12 34 56 78" className={big} />
      <p id="identifier-hint" className="text-sm text-muted">{t("Login.identifierHint")}</p>
      <label htmlFor="password" className="mt-2 text-lg font-semibold">{t("Login.passwordLabel")}</label>
      <input id="password" name="password" type="password" autoComplete="current-password" dir="ltr" required maxLength={128} className={big} />
      {needsCaptcha && <CaptchaField key={captchaKey} onSolved={setCaptcha} />}
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <button type="submit" disabled={busy || (needsCaptcha && !captcha)} className={`${primary} mt-4`}>{t("Login.signIn")}</button>
    </form>
  );
}
