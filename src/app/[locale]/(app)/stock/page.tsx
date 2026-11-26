import { useTranslations } from "next-intl";
import { Page } from "@/components/page";
import { StockScreen } from "@/components/stock";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Farms.saveFailed", "Farms.saved", "Farms.title", "Stock", "Sync.login", "Sync.signedOut", "errors"];

// A static shell, precached by the service worker (src/app/serwist): stock comes from IndexedDB (poultry-pwa §0.3).
// One of the nav's tabs: no back link.
export default function Stock() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" title={t("Stock.title")}>
        <StockScreen />
      </Page>
    </ClientMessages>
  );
}
