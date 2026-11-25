import { useTranslations } from "next-intl";
import { ProtocolScreen } from "@/components/protocol";
import { BackLink } from "@/components/app-nav";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Farms.saveFailed", "Farms.saved", "Nav", "Protocol", "Sync.login", "Sync.refused", "Sync.signedOut"];

// A static shell, precached by the service worker (src/app/serwist): the template comes from the cached reference
// data, the organisation's copies from IndexedDB (poultry-pwa §0.3).
export default function Protocol() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
        <h1 className="text-2xl font-semibold">{t("Protocol.title")}</h1>
        <ProtocolScreen />
      </main>
    </ClientMessages>
  );
}
