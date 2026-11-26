import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { Page } from "@/components/page";
import { PricesScreen } from "@/components/prices";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Farms.saveFailed", "Farms.saved", "Nav", "Prices", "Sync.login", "Sync.signedOut", "Ui", "errors.INVALID_QUANTITY"];

// A static shell, precached by the service worker (src/app/serwist): the prices come from IndexedDB (SPEC-m5 MP2).
export default function PricesPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Prices.title")}>
        {/* the screen reads the search params (its product tab and page) */}
        <Suspense>
          <PricesScreen />
        </Suspense>
      </Page>
    </ClientMessages>
  );
}
