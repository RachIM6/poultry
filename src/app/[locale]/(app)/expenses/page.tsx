import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { ExpensesScreen } from "@/components/expenses";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Expenses", "Farms.saveFailed", "Farms.saved", "Files", "Offline", "Receivables.cancel", "Sale.vat", "Sync.login", "Sync.signedOut", "errors"];

// A static shell, precached by the service worker (src/app/serwist): expenses and accounts come from IndexedDB (poultry-pwa §0.3).
export default function ExpensesPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
        <h1 className="text-2xl font-semibold">{t("Expenses.title")}</h1>
        {/* the screen reads the search params (FC9's prefill) */}
        <Suspense>
          <ExpensesScreen />
        </Suspense>
      </main>
    </ClientMessages>
  );
}
