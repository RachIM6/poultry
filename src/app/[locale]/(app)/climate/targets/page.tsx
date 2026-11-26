import { useTranslations } from "next-intl";
import { ClimateTargetsScreen } from "@/components/climate-targets";
import { Page } from "@/components/page";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";
import { ClimateTabs } from "../climate-tabs";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Climate", "Farms.saveFailed", "Farms.saved", "Nav", "Pay.source", "Pay.validFrom", "Receivables.cancel", "Sync.login", "Sync.signedOut", "Types", "Ui", "errors"];

// A static shell, precached by the service worker (src/app/serwist): the targets come from IndexedDB (SPEC-m4 CL1).
export default function ClimateTargetsPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Climate.title")} nav={<ClimateTabs current="targets" />}>
        <ClimateTargetsScreen />
      </Page>
    </ClientMessages>
  );
}
