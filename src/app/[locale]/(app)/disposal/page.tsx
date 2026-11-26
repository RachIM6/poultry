import { useTranslations } from "next-intl";
import { DisposalScreen } from "@/components/biosecurity";
import { Page } from "@/components/page";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Biosecurity", "Cleanout", "Disposal", "Farms.saveFailed", "Farms.saved", "Files", "Nav", "Offline", "Sync.login", "Sync.signedOut", "Visitors", "errors"];

// A static shell, precached by the service worker (src/app/serwist): farms, batches, daily entries, disposals and manure come from IndexedDB (poultry-pwa §0.3).
// Wide screens: each log's form beside its history (DisposalScreen).
export default function DisposalPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Disposal.title")}>
        <DisposalScreen />
      </Page>
    </ClientMessages>
  );
}
