import { useTranslations } from "next-intl";
import { CleanoutScreen } from "@/components/biosecurity";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";

// A static shell, precached by the service worker (src/app/serwist): farms, houses, batches and clean-outs come from IndexedDB (poultry-pwa §0.3).
export default function CleanoutPage() {
  const t = useTranslations();
  return (
    <>
      <header className="flex justify-between gap-4 p-4">
        <Link href="/sync" className="py-2 underline underline-offset-4">{t("Sync.open")}</Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-4">
        <h1 className="text-2xl font-semibold">{t("Cleanout.title")}</h1>
        <CleanoutScreen />
      </main>
    </>
  );
}
