"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

// SPEC I3: the choice is also saved on the user (pushes, inbox), fire-and-forget. Offline or signed out, only the URL
// changes; the next login saves the language again. keepalive: the request outlives the page if the navigation is hard.
const save = (locale: string) =>
  navigator.onLine &&
  fetch("/api/locale", { method: "POST", keepalive: true, headers: { "content-type": "application/json", "x-requested-with": "poultry" }, body: JSON.stringify({ locale }) }).catch(() => {});

// The documents name their record in the URL (/origin#sale, /register#batch, /inspection#farm): keep it.
const onHashChange = (notify: () => void) => (window.addEventListener("hashchange", notify), () => window.removeEventListener("hashchange", notify));
const useSearchAndHash = () => useSyncExternalStore(onHashChange, () => window.location.search + window.location.hash, () => "");

// Keeps the current page and swaps the locale prefix. Each name is written in its own language.
export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const current = useLocale();
  const href = usePathname() + useSearchAndHash();
  return (
    <nav aria-label={t("label")} className="flex gap-4">
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={href}
          locale={locale}
          lang={locale}
          aria-current={locale === current ? "page" : undefined}
          onClick={locale === current ? undefined : () => save(locale)}
          className="inline-flex min-h-11 items-center underline-offset-4 aria-[current=page]:font-semibold aria-[current=page]:underline"
        >
          {t(locale)}
        </Link>
      ))}
    </nav>
  );
}
