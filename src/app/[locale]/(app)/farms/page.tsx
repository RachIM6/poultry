import { useTranslations } from "next-intl";
import { FarmsScreen } from "@/components/farms";

// A static shell, precached by the service worker (src/app/serwist): farms and houses come from IndexedDB, and a
// farm opens as /farms#<id> so every view is this same precached page (poultry-pwa §0.3).
export default function Farms() {
  const t = useTranslations();
  return (
    <>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
        <h1 className="text-2xl font-semibold">{t("Farms.title")}</h1>
        <FarmsScreen />
      </main>
    </>
  );
}
