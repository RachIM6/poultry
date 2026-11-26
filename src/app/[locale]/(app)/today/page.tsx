import { TodayShell } from "@/components/today";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = [
  "App", "Bank.amount", "Batches", "Close.quantity", "Compare", "Count.eggs", "Day", "EggSale",
  "Expenses.categories.water", "Farms.none", "Farms.title", "Origin", "Protocol.methods", "Sale.birds", "Sale.buyer",
  "Sale.price", "Sale.pricing", "Stock.item", "Stock.supplier", "Strip", "Sync", "Today", "Treatment.withdrawal", "Types",
  "Vaccination.status", "VetVisit", "Weighing", "errors.EGGS_IN_WITHDRAWAL",
];

// tasks/plan-ui.md U10: "Aujourd'hui" without network. A static shell, precached by the service worker, which serves
// it when /dashboard can't be reached (src/sw.ts). Reads who is signed in and the farm from the phone's database.
export default function TodayOffline() {
  return (
    <ClientMessages paths={MESSAGES}>
      <TodayShell />
    </ClientMessages>
  );
}
