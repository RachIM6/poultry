import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { RegisterScreen } from "@/components/register-document";
import { Link } from "@/i18n/navigation";
import { link } from "@/components/ui";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["App", "Day", "Disposal.methods", "Inspection.state", "LocaleSwitcher", "Protocol.methods", "Register", "Sync.login", "Sync.signedOut", "Treatment.routes", "Types"];

// A static shell, precached by the service worker (src/app/serwist): the batch and its records come from IndexedDB (poultry-pwa §0.3).
// Only the document prints: the header is for the screen.
export default function RegisterPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <header className="flex justify-between gap-4 p-4 print:hidden">
        <Link href="/batches" className={link}>{t("Batches.title")}</Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 print:max-w-none print:p-0">
        <RegisterScreen />
      </main>
    </ClientMessages>
  );
}
