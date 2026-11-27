import { useTranslations } from "next-intl";
import { FarmsScreen } from "@/components/farms";
import { Page } from "@/components/page";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Farms", "Nav", "Sync.login", "Sync.refused", "Sync.signedOut", "Ui"];

// A static shell, precached by the service worker (src/app/serwist): farms and houses come from IndexedDB, and a
// farm opens as /farms#<id> so every view is this same precached page (poultry-pwa §0.3).
export default function Farms() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Farms.title")}>
        <FarmsScreen />
      </Page>
    </ClientMessages>
  );
}
