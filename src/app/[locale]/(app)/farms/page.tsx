import { useTranslations } from "next-intl";
import { FarmsScreen } from "@/components/farms";
import { BackLink } from "@/components/app-nav";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Farms", "Nav", "Sync.login", "Sync.refused", "Sync.signedOut"];

// A static shell, precached by the service worker (src/app/serwist): farms and houses come from IndexedDB, and a
// farm opens as /farms#<id> so every view is this same precached page (poultry-pwa §0.3).
export default function Farms() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
        <h1 className="text-2xl font-semibold">{t("Farms.title")}</h1>
        <FarmsScreen />
      </main>
    </ClientMessages>
  );
}
