import { useTranslations } from "next-intl";
import { PricesScreen } from "@/components/prices";

// A static shell, precached by the service worker (src/app/serwist): the prices come from IndexedDB (SPEC-m5 MP2).
export default function PricesPage() {
  const t = useTranslations();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{t("Prices.title")}</h1>
      <PricesScreen />
    </main>
  );
}
