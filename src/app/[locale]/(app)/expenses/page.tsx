import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { ExpensesScreen } from "@/components/expenses";

// A static shell, precached by the service worker (src/app/serwist): expenses and accounts come from IndexedDB (poultry-pwa §0.3).
export default function ExpensesPage() {
  const t = useTranslations();
  return (
    <>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
        <h1 className="text-2xl font-semibold">{t("Expenses.title")}</h1>
        {/* the screen reads the search params (FC9's prefill) */}
        <Suspense>
          <ExpensesScreen />
        </Suspense>
      </main>
    </>
  );
}
