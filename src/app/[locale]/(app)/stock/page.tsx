import { useTranslations } from "next-intl";
import { StockScreen } from "@/components/stock";

// A static shell, precached by the service worker (src/app/serwist): stock comes from IndexedDB (poultry-pwa §0.3).
export default function Stock() {
  const t = useTranslations();
  return (
    <>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
        <h1 className="text-2xl font-semibold">{t("Stock.title")}</h1>
        <StockScreen />
      </main>
    </>
  );
}
