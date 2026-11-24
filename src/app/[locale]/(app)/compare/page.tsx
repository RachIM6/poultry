import { useTranslations } from "next-intl";
import { CompareScreen } from "@/components/compare";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";
import { link } from "@/components/ui";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Batches.type", "Compare", "LocaleSwitcher", "Sync.login", "Sync.signedOut", "Types"];

// A static shell, precached by the service worker (src/app/serwist): closed batches come from IndexedDB (SPEC-m3 D2).
export default function Compare() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <header className="flex justify-between gap-4 p-4">
        <Link href="/sync" className={link}>{t("Sync.open")}</Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
        <h1 className="text-2xl font-semibold">{t("Compare.title")}</h1>
        <CompareScreen />
      </main>
    </ClientMessages>
  );
}
