import { useTranslations } from "next-intl";
import { TasksScreen } from "@/components/tasks";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Attendance", "Farms.none", "Farms.saveFailed", "Farms.saved", "Nav", "Receivables.cancel", "Staff", "Sync.login", "Sync.signedOut", "Tasks", "errors.HOUSE_REQUIRED"];

// A static shell, precached by the service worker (src/app/serwist): the day's tasks are computed from IndexedDB (SPEC-m4 §7).
export default function TasksPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-semibold">{t("Tasks.title")}</h1>
        <TasksScreen />
      </main>
    </ClientMessages>
  );
}
