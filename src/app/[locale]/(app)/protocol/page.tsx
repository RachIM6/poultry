import { useTranslations } from "next-intl";
import { ProtocolScreen } from "@/components/protocol";
import { Page } from "@/components/page";
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
      <Page width="wide" back="/more" title={t("Protocol.title")}>
        <ProtocolScreen />
      </Page>
    </ClientMessages>
  );
}
