import { useTranslations } from "next-intl";
import { DocumentsScreen } from "@/components/documents";
import { Page } from "@/components/page";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Documents", "Farms.saveFailed", "Farms.saved", "Files", "Nav", "Offline", "Sync.login", "Sync.signedOut", "Ui", "errors"];

// A static shell, precached by the service worker (src/app/serwist): farms and documents come from IndexedDB (poultry-pwa §0.3).
export default function DocumentsPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      {/* #actions: the screen puts « Ajouter un document » there (components/documents.tsx) */}
      <Page width="wide" back="/more" title={t("Documents.titlePage")} actions={<span id="actions" className="contents" />}>
        <DocumentsScreen />
      </Page>
    </ClientMessages>
  );
}
