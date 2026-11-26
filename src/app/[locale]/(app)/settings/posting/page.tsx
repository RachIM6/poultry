import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { splitNarrow } from "@/components/layout";
import { Page } from "@/components/page";
import { redirect } from "@/i18n/navigation";
import { postingOverrides } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { OverridesForm } from "./form";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Chart.ops", "Expenses.categories", "Nav", "Offline", "Overrides", "Sync.refused", "errors"];

// SPEC-finance FN8: the owner replaces the account of a default posting rule for the entity. Online, owner only (finance.manage).
// Wide screens: the rules as a table, the form beside it.
export default function PostingOverridesPage() {
  return (
    <ClientMessages paths={MESSAGES}>
      <Suspense fallback={<Page width="wide" back="/settings/accounting" />}>
        <Content />
      </Suspense>
    </ClientMessages>
  );
}

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const view = await postingOverrides(ctx.value);
  if (!view.ok) return redirect({ href: "/dashboard", locale: lang }); // not the owner; the action re-checks can()
  if (!view.value) return <Page width="wide" back="/settings/accounting"><p>{t("Accounting.none")}</p></Page>;
  return (
    <Page width="wide" back="/settings/accounting" title={t("Overrides.title")}>
      <p className="max-w-prose">{t("Overrides.intro")}</p>
      <div className={splitNarrow}>
        <OverridesForm rows={view.value.rows} choices={view.value.choices} />
      </div>
    </Page>
  );
}
