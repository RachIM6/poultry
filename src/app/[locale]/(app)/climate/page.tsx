import { useTranslations } from "next-intl";
import { ClimateScreen } from "@/components/climate";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Climate", "Farms.none", "Farms.saveFailed", "Farms.saved", "Pay.source", "Pay.validFrom", "Receivables.cancel", "Sync.login", "Sync.signedOut", "Types", "errors"];

// A static shell, precached by the service worker (src/app/serwist): houses, batches and targets come from IndexedDB (SPEC-m4 CL2).
export default function ClimatePage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 p-4">
        <h1 className="text-2xl font-semibold">{t("Climate.title")}</h1>
        <ClimateScreen />
      </main>
    </ClientMessages>
  );
}
