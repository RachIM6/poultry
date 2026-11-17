import { useTranslations } from "next-intl";
import { TasksScreen } from "@/components/tasks";

// A static shell, precached by the service worker (src/app/serwist): the day's tasks are computed from IndexedDB (SPEC-m4 §7).
export default function TasksPage() {
  const t = useTranslations();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{t("Tasks.title")}</h1>
      <TasksScreen />
    </main>
  );
}
