import { useTranslations } from "next-intl";
import { InboxScreen } from "@/components/inbox";
import { BackLink } from "@/components/app-nav";

// A static shell, precached by the service worker (src/app/serwist): the notifications come from IndexedDB, and a
// push opens this page (src/sw.ts).
export default function Inbox() {
  const t = useTranslations();
  return (
    <>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-4">
        <h1 className="text-2xl font-semibold">{t("Inbox.title")}</h1>
        <InboxScreen />
      </main>
    </>
  );
}
