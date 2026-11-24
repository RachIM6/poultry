import { useTranslations } from "next-intl";
import { PlanningScreen } from "@/components/planning";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Batches", "Farms.none", "Farms.saveFailed", "Farms.saved", "Pay.source", "Pay.validFrom", "Planning", "Receivables.cancel", "Staff", "Sync.login", "Sync.signedOut", "errors"];

// A static shell, precached by the service worker (src/app/serwist): houses, batches and plans come from IndexedDB (SPEC-m5 PL2).
export default function PlanningPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-semibold">{t("Planning.title")}</h1>
        <PlanningScreen />
      </main>
    </ClientMessages>
  );
}
