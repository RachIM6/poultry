import { useTranslations } from "next-intl";
import { InboxScreen } from "@/components/inbox";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";

// A static shell, precached by the service worker (src/app/serwist): the notifications come from IndexedDB, and a
// push opens this page (src/sw.ts).
export default function Inbox() {
  const t = useTranslations();
  return (
    <>
      <header className="flex justify-between gap-4 p-4">
        <Link href="/dashboard" className="py-2 underline underline-offset-4">{t("Members.back")}</Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-4">
        <h1 className="text-2xl font-semibold">{t("Inbox.title")}</h1>
        <InboxScreen />
      </main>
    </>
  );
}
