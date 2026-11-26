import { useTranslations } from "next-intl";
import { Page } from "@/components/page";
import { ReceivablesScreen } from "@/components/receivables";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Farms.saveFailed", "Farms.saved", "Nav", "Receivables", "Sale.instrumentDueOn", "Sale.instrumentNumber", "Sale.methods", "Sync.login", "Sync.signedOut", "Ui", "errors"];

// A static shell, precached by the service worker (src/app/serwist): receivables come from IndexedDB (poultry-pwa §0.3).
export default function ReceivablesPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Receivables.title")}>
        <ReceivablesScreen />
      </Page>
    </ClientMessages>
  );
}
