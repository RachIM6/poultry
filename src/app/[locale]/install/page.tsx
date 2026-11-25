import { useTranslations } from "next-intl";
import { InstallGuide } from "@/components/install-guide";
import { BackLink } from "@/components/app-nav";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Install", "Nav", "Sync.refused"];

export default function Install() {
  const t = useTranslations("Install");
  return (
    <ClientMessages paths={MESSAGES}>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
        <BackLink href="/" />
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <InstallGuide />
      </main>
    </ClientMessages>
  );
}
