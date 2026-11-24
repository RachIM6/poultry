"use client";

import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { link, secondary } from "@/components/ui";
import { Link } from "@/i18n/navigation";

const KEY = "accounting-choices-later";
const later = () => {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * SPEC-finance FN1: the accounting choices lock with the year's first entry, and placements, purchases and expenses
 * post one as soon as they sync. Until then the owner is asked to make them; "Plus tard" hides it for the session.
 */
export function ChoicesBanner() {
  const t = useTranslations("Accounting");
  const hidden = useSyncExternalStore(() => () => {}, later, () => false);
  const [dismissed, setDismissed] = useState(false);
  if (hidden || dismissed) return null;
  const dismiss = () => {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {}
    setDismissed(true);
  };
  return (
    <section aria-label={t("title")} className="flex flex-col gap-2 rounded-2xl bg-chick-soft p-4">
      <p>{t("choicesFirst")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/settings/accounting" className={`${link} font-semibold`}>{t("open")}</Link>
        <button type="button" onClick={dismiss} className={secondary}>{t("later")}</button>
      </div>
    </section>
  );
}
