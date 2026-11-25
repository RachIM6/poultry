import { useTranslations } from "next-intl";
import { StaffScreen } from "@/components/staff";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = [
  "Advances", "Attendance", "Expenses.note", "Farms.none", "Farms.saveFailed", "Farms.saved", "Pay",
  "Receivables.cancel", "Records", "Staff", "Sync.login", "Sync.signedOut", "errors.DEDUCT_BEFORE_ADVANCE",
  "errors.INVALID_INPUT", "errors.INVALID_QUANTITY", "errors.LEFT_BEFORE_START",
];

// A static shell, precached by the service worker (src/app/serwist): employees come from IndexedDB (SPEC-m4 §7).
export default function StaffPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
        <h1 className="text-2xl font-semibold">{t("Staff.title")}</h1>
        <StaffScreen />
      </main>
    </ClientMessages>
  );
}
