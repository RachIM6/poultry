import { useTranslations } from "next-intl";
import { Page } from "@/components/page";
import { TasksScreen } from "@/components/tasks";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Attendance", "Farms.none", "Farms.saveFailed", "Farms.saved", "Nav", "Receivables.cancel", "Staff", "Sync.login", "Sync.signedOut", "Tasks", "Ui", "errors.HOUSE_REQUIRED"];

// A static shell, precached by the service worker (src/app/serwist): the day's tasks are computed from IndexedDB (SPEC-m4 §7).
export default function TasksPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      {/* A form-wide page for the worker; from lg, as wide as a `wide` page when the screen holds the tasks to assign
          ([data-assign], components/tasks.tsx). CSS only: the role is the phone's, known once IndexedDB is read. */}
      <div className="contents lg:[&>main:has([data-assign])]:max-w-6xl">
        <Page width="form" back="/more" title={t("Tasks.title")}>
          <TasksScreen />
        </Page>
      </div>
    </ClientMessages>
  );
}
