import { useTranslations } from "next-intl";
import { ReceivablesScreen } from "@/components/receivables";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Farms.saveFailed", "Farms.saved", "Receivables", "Sale.instrumentDueOn", "Sale.instrumentNumber", "Sale.methods", "Sync.login", "Sync.signedOut", "errors"];

// A static shell, precached by the service worker (src/app/serwist): receivables come from IndexedDB (poultry-pwa §0.3).
export default function ReceivablesPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4 lg:max-w-5xl">
        <h1 className="text-2xl font-semibold">{t("Receivables.title")}</h1>
        <ReceivablesScreen />
      </main>
    </ClientMessages>
  );
}
