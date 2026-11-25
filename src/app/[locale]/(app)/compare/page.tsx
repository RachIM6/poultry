import { useTranslations } from "next-intl";
import { CompareScreen } from "@/components/compare";
import { Page } from "@/components/page";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Batches.type", "Compare", "Nav", "Sync.login", "Sync.signedOut", "Types"];

// A static shell, precached by the service worker (src/app/serwist): closed batches come from IndexedDB (SPEC-m3 D2).
export default function Compare() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Compare.title")}>
        <CompareScreen />
      </Page>
    </ClientMessages>
  );
}
