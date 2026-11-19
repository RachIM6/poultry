import { useTranslations } from "next-intl";
import { ReceivablesScreen } from "@/components/receivables";

// A static shell, precached by the service worker (src/app/serwist): receivables come from IndexedDB (poultry-pwa §0.3).
export default function ReceivablesPage() {
  const t = useTranslations();
  return (
    <>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
        <h1 className="text-2xl font-semibold">{t("Receivables.title")}</h1>
        <ReceivablesScreen />
      </main>
    </>
  );
}
