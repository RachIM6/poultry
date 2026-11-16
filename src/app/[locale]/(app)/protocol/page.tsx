import { useTranslations } from "next-intl";
import { ProtocolScreen } from "@/components/protocol";

// A static shell, precached by the service worker (src/app/serwist): the template comes from the cached reference
// data, the organisation's copies from IndexedDB (poultry-pwa §0.3).
export default function Protocol() {
  const t = useTranslations();
  return (
    <>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
        <h1 className="text-2xl font-semibold">{t("Protocol.title")}</h1>
        <ProtocolScreen />
      </main>
    </>
  );
}
