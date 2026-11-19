"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { postJson } from "@/lib/api";
import { danger, primary as button } from "@/components/ui";


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
    if (res.status === 200) router.replace("/dashboard");
    else setError(res.messageKey);
  });

  const big = "h-[60px] rounded-2xl border-2 border-ink bg-card px-4 text-[22px] font-medium text-ink placeholder:text-muted";
  return step === "phone" ? (
    <form onSubmit={sendCode} className="flex flex-1 flex-col gap-2.5">
      <label htmlFor="phone" className="text-lg font-semibold">{t("Login.phoneLabel")}</label>
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
        className={big}
      />
      <p id="phone-hint" className="text-sm text-muted">{t("Login.phoneHint")}</p>
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <div className="mt-auto flex flex-col gap-3 pt-6">
        <button type="submit" disabled={busy} className={button}>{t("Login.sendCode")}</button>
        <p className="text-center text-[13px] text-muted">{t("Login.noPassword")}</p>
      </div>
    </form>
  ) : (
    <form onSubmit={verify} className="flex flex-1 flex-col gap-3">
      <p role="status" className="text-base text-ink-2">{t("Login.codeSent")}</p>
      <label htmlFor="code" className="text-lg font-semibold">{t("Login.codeLabel")}</label>
      <input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        dir="ltr"
        required
        pattern="\d{6}"
        maxLength={6}
        placeholder="••••••"
        className={`${big} h-16 text-center text-[28px] font-semibold tracking-[0.5em]`}
      />
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <button type="button" onClick={() => setStep("phone")} className="self-end min-h-11 underline underline-offset-4">
        {t("Login.changeNumber")}
      </button>
      <button type="submit" disabled={busy} className={`${button} mt-auto`}>{t("Login.verify")}</button>
    </form>
  );
}
