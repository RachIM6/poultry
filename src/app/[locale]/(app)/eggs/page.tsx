import { useTranslations } from "next-intl";
import { EggStockScreen } from "@/components/egg-stock";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";

// A static shell, precached by the service worker (src/app/serwist): the egg stock comes from IndexedDB (SPEC-m3 E4).
export default function Eggs() {
  const t = useTranslations();
  return (
    <>
      <header className="flex justify-between gap-4 p-4">
        <Link href="/sync" className="py-2 underline underline-offset-4">{t("Sync.open")}</Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-4">
        <h1 className="text-2xl font-semibold">{t("EggStock.title")}</h1>
        <EggStockScreen />
      </main>
    </>
  );
}
