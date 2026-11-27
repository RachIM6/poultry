import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { InboxScreen } from "@/components/inbox";
import { Page } from "@/components/page";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Inbox", "Nav", "Notifications.templates", "Sync.login", "Sync.refused", "Sync.signedOut", "Ui", "errors"];

// A static shell, precached by the service worker (src/app/serwist): the notifications come from IndexedDB, and a
// push opens this page (src/sw.ts).
export default function Inbox() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Inbox.title")}>
        {/* the screen reads its ?tab= and ?page= */}
        <Suspense>
          <InboxScreen />
        </Suspense>
      </Page>
    </ClientMessages>
  );
}
