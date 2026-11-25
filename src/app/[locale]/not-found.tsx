import { useLocale, useTranslations } from "next-intl";
import { primary } from "@/components/ui";

// An unknown /fr/… or /ar/… address (the catch-all beside it) or a notFound() below [locale], in the page's language.
// The root layout is [locale]'s, so an unknown locale (/de) still gets Next's own 404. Next sends this file with every
// page under [locale]: a plain link, so no client component joins /batches' JS budget (SPEC §9.3).
export default function NotFound() {
  const t = useTranslations("NotFound");
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-3.5 px-6 pb-8 pt-24">
      <h1 className="text-[26px] font-semibold leading-snug">{t("title")}</h1>
      <p className="text-ink-2">{t("body")}</p>
      <a href={`/${useLocale()}`} className={`${primary} mt-auto`}>
        {t("home")}
      </a>
    </main>
  );
}
