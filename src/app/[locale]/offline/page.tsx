import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// Precached by the service worker and shown for pages not yet saved on this phone (src/sw.ts).
export default function Offline() {
  const t = useTranslations("Offline");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p>{t("body")}</p>
      <Link href="/" className="underline underline-offset-4">
        {t("home")}
      </Link>
    </main>
  );
}
