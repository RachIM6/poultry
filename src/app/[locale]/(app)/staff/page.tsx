import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { Page } from "@/components/page";
import { StaffScreen } from "@/components/staff";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = [
  "Advances", "Attendance", "Expenses.note", "Farms.none", "Farms.saveFailed", "Farms.saved", "Nav", "Pay",
  "Receivables.cancel", "Records", "Staff", "Sync.login", "Sync.signedOut", "Ui", "errors.DEDUCT_BEFORE_ADVANCE",
  "errors.INVALID_INPUT", "errors.INVALID_QUANTITY", "errors.LEFT_BEFORE_START",
];

// A static shell, precached by the service worker (src/app/serwist): employees come from IndexedDB (SPEC-m4 §7).
export default function StaffPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Staff.title")}>
        {/* the screen reads its ?tab= and ?page= */}
        <Suspense>
          <StaffScreen />
        </Suspense>
      </Page>
    </ClientMessages>
  );
}
