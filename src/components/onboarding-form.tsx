"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { postJson } from "@/lib/api";
import { danger, field, primary as button } from "@/components/ui";


// The forms come from the page (farm-registry's LEGAL_FORMS): importing the module here would bundle its server code.
export function OnboardingForm({ forms }: { forms: readonly string[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const data = new FormData(e.currentTarget);
    const res = await postJson("/api/onboarding", { name: data.get("name"), form: data.get("form"), locale });
    // 409: an earlier submit already created it, so the dashboard is the right place either way.
    if (res.status === 201 || res.status === 409) return router.replace("/dashboard");
    if (res.status === 401) return router.replace("/login");
    setError(res.messageKey);
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="font-medium">{t("Onboarding.nameLabel")}</label>
        <input id="name" name="name" required maxLength={120} autoComplete="organization" className={field} />
      </div>
      <fieldset className="flex flex-col gap-2" aria-describedby="form-hint">
        <legend className="mb-2 font-medium">{t("Onboarding.formLabel")}</legend>
        <div className="grid gap-2.5 sm:grid-cols-2">
        {forms.map((form) => (
          <label key={form} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4 font-semibold has-checked:border-2 has-checked:border-ink has-checked:shadow-[0_6px_18px_rgba(36,33,28,.08)]">
            <input type="radio" name="form" value={form} required className="size-5 accent-ink" />
            {t(`Onboarding.forms.${form}`)}
          </label>
        ))}
        </div>
        <p id="form-hint" className="text-sm text-muted">{t("Onboarding.formHint")}</p>
      </fieldset>
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <button type="submit" disabled={busy} className={button}>{t("Onboarding.submit")}</button>
    </form>
  );
}
