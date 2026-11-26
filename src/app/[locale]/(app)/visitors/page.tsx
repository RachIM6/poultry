import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { VisitorsScreen } from "@/components/biosecurity";
import { Page } from "@/components/page";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Biosecurity", "Cleanout", "Disposal", "Farms.saveFailed", "Farms.saved", "Files", "Nav", "Offline", "Sync.login", "Sync.signedOut", "Ui", "Visitors", "errors"];

// A static shell, precached by the service worker (src/app/serwist): farms and visits come from IndexedDB (poultry-pwa §0.3).
// Wide screens: the form beside today's visitors (VisitorsScreen).
export default function VisitorsPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Visitors.title")}>
        {/* the screen reads its ?tab= and ?page= */}
        <Suspense>
          <VisitorsScreen />
        </Suspense>
      </Page>
    </ClientMessages>
  );
}
