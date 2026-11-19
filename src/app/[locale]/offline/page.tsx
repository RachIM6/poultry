import { useTranslations } from "next-intl";
import { primary } from "@/components/ui";
import { Link } from "@/i18n/navigation";

// Precached by the service worker and shown for pages not yet saved on this phone (src/sw.ts).
export default function Offline() {
  const t = useTranslations("Offline");
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-3.5 px-6 pb-8 pt-24">
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
        <rect width="88" height="88" rx="24" className="fill-ink" />
        <path d="M24 58h40a12 12 0 0 0 1.5-23.9A18 18 0 0 0 31 31.5 13 13 0 0 0 24 58z" fill="none" strokeWidth="5" strokeLinejoin="round" className="stroke-chick" />
        <path d="M20 20l48 48" strokeWidth="5" strokeLinecap="round" className="stroke-shell" />
      </svg>
      <h1 className="text-[26px] font-semibold leading-snug">{t("title")}</h1>
      <p className="text-ink-2">{t("body")}</p>
      <Link href="/" className={`${primary} mt-auto`}>
        {t("home")}
      </Link>
    </main>
  );
}
