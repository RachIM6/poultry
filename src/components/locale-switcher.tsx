"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

// Keeps the current page and swaps the locale prefix. Each name is written in its own language.
export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const current = useLocale();
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="flex gap-4">
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          lang={locale}
          aria-current={locale === current ? "page" : undefined}
          className="py-2 underline-offset-4 aria-[current=page]:font-semibold aria-[current=page]:underline"
        >
          {t(locale)}
        </Link>
      ))}
    </nav>
  );
}
