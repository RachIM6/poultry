import { useTranslations } from "next-intl";
import { PlanningScreen } from "@/components/planning";

// A static shell, precached by the service worker (src/app/serwist): houses, batches and plans come from IndexedDB (SPEC-m5 PL2).
export default function PlanningPage() {
  const t = useTranslations();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{t("Planning.title")}</h1>
      <PlanningScreen />
    </main>
  );
}
