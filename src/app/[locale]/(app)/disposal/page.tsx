import { useTranslations } from "next-intl";
import { DisposalScreen } from "@/components/biosecurity";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";
import { link } from "@/components/ui";

// A static shell, precached by the service worker (src/app/serwist): farms, batches, daily entries, disposals and manure come from IndexedDB (poultry-pwa §0.3).
export default function DisposalPage() {
  const t = useTranslations();
  return (
    <>
      <header className="flex justify-between gap-4 p-4">
        <Link href="/sync" className={link}>{t("Sync.open")}</Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-4">
        <h1 className="text-2xl font-semibold">{t("Disposal.title")}</h1>
        <DisposalScreen />
      </main>
    </>
  );
}
