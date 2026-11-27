import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { ExpensesScreen } from "@/components/expenses";
import { Page } from "@/components/page";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Expenses", "Farms.saveFailed", "Farms.saved", "Files", "Nav", "Offline", "Receivables.cancel", "Sale.vat", "Sync.login", "Sync.signedOut", "Ui", "errors"];

// A static shell, precached by the service worker (src/app/serwist): expenses and accounts come from IndexedDB (poultry-pwa §0.3).
export default function ExpensesPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Expenses.title")}>
        {/* the screen reads the search params (FC9's prefill) */}
        <Suspense>
          <ExpensesScreen />
        </Suspense>
      </Page>
    </ClientMessages>
  );
}
