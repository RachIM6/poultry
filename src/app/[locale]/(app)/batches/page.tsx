import { useTranslations } from "next-intl";
import { BatchesScreen } from "@/components/batches";

// A static shell, precached by the service worker (src/app/serwist): batches come from IndexedDB (poultry-pwa §0.3).
export default function Batches() {
  const t = useTranslations();
  return (
    <>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
        <h1 className="text-2xl font-semibold">{t("Batches.title")}</h1>
        <BatchesScreen />
      </main>
    </>
  );
}
