import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SyncPanel } from "@/components/sync-status";
import { Link } from "@/i18n/navigation";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = [
  "Bank.amount", "Batches.house", "Close.quantity", "Compare", "Count.eggs", "Day", "EggSale",
  "Expenses.categories.water", "LocaleSwitcher", "Origin", "Sale.birds", "Sale.buyer", "Sale.price", "Sale.pricing",
  "Stock.item", "Stock.supplier", "Sync", "VetVisit", "Weighing", "errors",
];

// A static shell, precached by the service worker (src/app/serwist): it must not read cookies or headers, so the
// signed-in user's data comes from IndexedDB on the client (poultry-pwa §0.3).
export default function Sync() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <header className="flex justify-end p-4">
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-4">
        <Link href="/dashboard" className="underline underline-offset-4">{t("Members.back")}</Link>
        <h1 className="text-2xl font-semibold">{t("Sync.title")}</h1>
        <SyncPanel />
      </main>
    </ClientMessages>
  );
}
