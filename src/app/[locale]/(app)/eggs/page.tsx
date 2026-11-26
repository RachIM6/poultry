import { useTranslations } from "next-intl";
import { EggStockScreen } from "@/components/egg-stock";
import { Page } from "@/components/page";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Closing", "EggSale", "EggStock", "Farms.saveFailed", "Farms.saved", "Nav", "Sale", "Sync.login", "Sync.signedOut", "errors"];

// A static shell, precached by the service worker (src/app/serwist): the egg stock comes from IndexedDB (SPEC-m3 E4).
export default function Eggs() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("EggStock.title")}>
        <EggStockScreen />
      </Page>
    </ClientMessages>
  );
}
