import { useTranslations } from "next-intl";
import { Page } from "@/components/page";
import { PlanningScreen } from "@/components/planning";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Batches", "Farms.none", "Farms.saveFailed", "Farms.saved", "Nav", "Pay.source", "Pay.validFrom", "Planning", "Receivables.cancel", "Staff", "Sync.login", "Sync.signedOut", "errors"];

// A static shell, precached by the service worker (src/app/serwist): houses, batches and plans come from IndexedDB (SPEC-m5 PL2).
export default function PlanningPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Planning.title")}>
        <PlanningScreen />
      </Page>
    </ClientMessages>
  );
}
