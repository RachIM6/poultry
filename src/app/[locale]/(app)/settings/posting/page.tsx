import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Page } from "@/components/page";
import { redirect } from "@/i18n/navigation";
import { postingOverrides } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { OverridesForm } from "./form";
import { SettingsTabs } from "../accounting/settings-tabs";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Chart.ops", "Expenses.categories", "Nav", "Offline", "Overrides", "Sync.refused", "Ui", "errors"];

// SPEC-finance FN8: the owner replaces the account of a default posting rule for the entity. Online, owner only (finance.manage).
// tasks/plan-ui-cleanup.md §3, §4: the « Comptes remplacés » tab of « Paramètres comptables »; each rule's « Remplacer »
// opens its form in a sheet.
export default function PostingOverridesPage() {
  return (
    <ClientMessages paths={MESSAGES}>
      <Suspense fallback={<Page width="wide" back="/more" />}>
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
  const shell = { width: "wide", back: "/more", title: t("Accounting.title"), nav: <SettingsTabs current="overrides" owner /> } as const; // owner only
  if (!view.value) return <Page {...shell}><p>{t("Accounting.none")}</p></Page>;
  return (
    <Page {...shell}>
      <p className="max-w-prose text-sm text-ink-2">{t("Overrides.intro")}</p>
      <OverridesForm rows={view.value.rows} choices={view.value.choices} />
    </Page>
  );
}
