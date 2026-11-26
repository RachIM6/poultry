import { useTranslations } from "next-intl";
import { DemoBanner } from "@/components/demo-banner";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { InspectionScreen } from "@/components/inspection";
import { Link } from "@/i18n/navigation";
import { link } from "@/components/ui";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = [
  "App", "Biosecurity", "Cleanout", "Day", "Disposal", "Documents", "Inspection", "LocaleSwitcher", "Protocol.methods",
  "Register", "Sync.login", "Sync.signedOut", "Treatment.routes", "Types", "Visitors",
];

// A static shell, precached by the service worker (src/app/serwist): the farm, its documents, logs and batches come from IndexedDB (poultry-pwa §0.3).
// Only the document prints: the header is for the screen.
export default function InspectionPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <DemoBanner />
      <header className="flex justify-between gap-4 p-4 print:hidden">
        <Link href="/more" className={link}>{t("Nav.more")}</Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 lg:max-w-6xl print:max-w-none print:p-0">
        <InspectionScreen />
      </main>
    </ClientMessages>
  );
}
