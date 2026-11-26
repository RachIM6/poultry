import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BatchReportView } from "@/components/batch-report";
import { Page } from "@/components/page";
import { redirect } from "@/i18n/navigation";
import { can } from "@/lib/permissions";
import { batchResultDtos } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Nav", "Report", "Sync.refused", "Weighing"];

// SPEC-m2-compliance RP3: the batch report, printable. Online, owner and manager: the money is finance's batch result
// (FN13), read on the server like /results; flock and health figures come from the phone's records. The back link sits
// above the report's own title (in BatchReportView); on paper only the report prints.
type Search = Promise<{ [key: string]: string | string[] | undefined }>;

export default function ReportPage({ searchParams }: { searchParams: Search }) {
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="doc" back="/batches">
        <Suspense>
          <Report searchParams={searchParams} />
        </Suspense>
      </Page>
    </ClientMessages>
  );
}

async function Report({ searchParams }: { searchParams: Search }) {
  const [ctx, lang, t, search] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations(), searchParams]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  if (!can(ctx.value, "money.read")) return <p>{t("Report.forbidden")}</p>;
  const results = await batchResultDtos(ctx.value);
  return <BatchReportView batchId={typeof search.batch === "string" ? search.batch : ""} results={results.ok ? results.value : []} />;
}
