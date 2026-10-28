"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { postJson } from "@/lib/api";

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const button = "rounded-lg bg-green-700 px-4 py-3 font-semibold text-white disabled:opacity-60";

export function LoginForm() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = (run: (form: HTMLFormElement) => Promise<void>) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    await run(e.currentTarget);
    setBusy(false);
  };

  const sendCode = submit(async () => {
    const res = await postJson("/api/auth/request-code", { phone });
    if (res.status === 202) setStep("code");
    else setError(res.messageKey);
  });

  const verify = submit(async (form) => {
    const code = new FormData(form).get("code");
    const res = await postJson("/api/auth/verify-code", { phone, code, locale });
    if (res.status === 200) router.replace("/account");
    else setError(res.messageKey);
  });

  return step === "phone" ? (
    <form onSubmit={sendCode} className="flex flex-col gap-3">
      <label htmlFor="phone">{t("Login.phoneLabel")}</label>
      <input
        id="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        dir="ltr"
        required
        // UX hint only: the server decides (src/modules/identity/domain/phone-number.ts).
        pattern="\s*(\+212|00212|212|0)[\s.\-]*[67]([\s.\-]*\d){8}\s*"
        placeholder="06 12 34 56 78"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        aria-describedby="phone-hint"
        className={field}
      />
      <p id="phone-hint" className="text-sm opacity-75">{t("Login.phoneHint")}</p>
      {error && <p role="alert">{t(error)}</p>}
      <button type="submit" disabled={busy} className={button}>{t("Login.sendCode")}</button>
    </form>
  ) : (
    <form onSubmit={verify} className="flex flex-col gap-3">
      <p role="status">{t("Login.codeSent")}</p>
      <label htmlFor="code">{t("Login.codeLabel")}</label>
      <input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        dir="ltr"
        required
        pattern="\d{6}"
        maxLength={6}
        className={`${field} tracking-[0.5em]`}
      />
      {error && <p role="alert">{t(error)}</p>}
      <button type="submit" disabled={busy} className={button}>{t("Login.verify")}</button>
      <button type="button" onClick={() => setStep("phone")} className="underline underline-offset-4">
        {t("Login.changeNumber")}
      </button>
    </form>
  );
}
