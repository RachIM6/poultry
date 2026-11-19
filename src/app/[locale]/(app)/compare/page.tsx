import { useTranslations } from "next-intl";
import { CompareScreen } from "@/components/compare";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";

// A static shell, precached by the service worker (src/app/serwist): closed batches come from IndexedDB (SPEC-m3 D2).
export default function Compare() {
  const t = useTranslations();
  return (
    <>
      <header className="flex justify-between gap-4 p-4">
        <Link href="/sync" className="py-2 underline underline-offset-4">{t("Sync.open")}</Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
        <h1 className="text-2xl font-semibold">{t("Compare.title")}</h1>
        <CompareScreen />
      </main>
    </>
  );
}
