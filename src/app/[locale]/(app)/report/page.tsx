import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BatchReportView } from "@/components/batch-report";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link, redirect } from "@/i18n/navigation";
import { can } from "@/lib/permissions";
import { batchResultDtos } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

// SPEC-m2-compliance RP3: the batch report, printable. Online, owner and manager: the money is finance's batch result
// (FN13), read on the server like /results; flock and health figures come from the phone's records.
type Search = Promise<{ [key: string]: string | string[] | undefined }>;

export default function ReportPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <header className="flex justify-between gap-4 p-4 print:hidden">
        <Link href="/batches" className="py-2 underline underline-offset-4">←</Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 print:max-w-none print:p-0">
        <Suspense>
          <Report searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function Report({ searchParams }: { searchParams: Search }) {
  const [ctx, lang, t, search] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations(), searchParams]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  if (!can(ctx.value, "money.read")) return <p>{t("Report.forbidden")}</p>;
  const results = await batchResultDtos(ctx.value);
  return <BatchReportView batchId={typeof search.batch === "string" ? search.batch : ""} results={results.ok ? results.value : []} />;
}
