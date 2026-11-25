import { useTranslations } from "next-intl";
import { BatchesScreen } from "@/components/batches";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// The refusals these screens can show: the codes of the domain rules they run on the phone (no server form here).
const ERRORS = `
  ACCUMULATED_ABOVE_BASE ALREADY_DONE BATCH_CLOSED BATCH_HAS_DATA DAY_BEFORE_PLACEMENT DAY_IN_FUTURE
  DEAD_ON_ARRIVAL_TOO_HIGH DISINFECTANT_REQUIRED DISPOSAL_METHOD_NOTE_REQUIRED DOWNTIME_BELOW_OFFICIAL
  DUE_DATE_WITHOUT_CREDIT EGGS_IN_WITHDRAWAL EGG_WITHDRAWAL_REQUIRED END_BEFORE_START FEWER_BIRDS_THAN_RECORDED
  HOUSE_HAS_OPEN_BATCH IMPORT_ACCOUNTS IMPORT_AFTER_END IMPORT_BALANCE IMPORT_CURRENCY IMPORT_EMPTY IMPORT_FIELD
  IMPORT_FORMAT IMPORT_INCOMPLETE INSTRUMENT_REQUIRED INVALID_INPUT INVALID_QUANTITY INVALID_SAMPLE
  INVALID_TRANSITION IN_SERVICE_BEFORE_ACQUISITION LAND_NOT_DEPRECIATED LIFE_REQUIRED LOT_REQUIRED
  MORE_BIRDS_THAN_ON_HAND MORE_DEAD_THAN_ON_HAND NOTHING_OWED NOT_ENOUGH_EGGS NOT_FOUND ONE_SIDE_PER_LINE
  OPENING_LIFE_OVER PAID_MORE_THAN_AMOUNT PAID_MORE_THAN_BALANCE PAID_MORE_THAN_OWED PLACEMENT_AFTER_DATA
  PLACEMENT_AFTER_HEALTH_RECORD PLACEMENT_IN_FUTURE PLACEMENT_OVERLAPS_PREVIOUS REASON_REQUIRED RESIDUAL_ABOVE_COST
  SPREAD_DECLARATION_REQUIRED STEP_ALREADY_DONE TOO_FEW_LINES UNBALANCED UNKNOWN_ACCOUNT VAT_MORE_THAN_AMOUNT
  VISIT_DIRTY_ZONE_ONLY WITHDRAWAL_IN_PROGRESS
`.trim().split(/\s+/).map((code) => `errors.${code}` as const);

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = [
  "Batches", "Closing", "Correct", "Day", "EggStock", "Eggs", "Farms.saveFailed", "Farms.saved", "Farms.title", "Kpi",
  "Layers", "LocaleSwitcher", "Notifiable", "Protocol", "Register.link", "Report.link", "Sale", "Stock.invalid", "Stock.units",
  "Sync.login", "Sync.signedOut", "Today", "Transfer", "Treatment", "Types", "Vaccination", "VetVisit", "Weighing",
  ...ERRORS,
];

// A static shell, precached by the service worker (src/app/serwist): batches come from IndexedDB (poultry-pwa §0.3).
export default function Batches() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4 lg:max-w-6xl">
        <h1 className="text-2xl font-semibold">{t("Batches.title")}</h1>
        <BatchesScreen />
      </main>
    </ClientMessages>
  );
}
