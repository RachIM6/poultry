import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { FarmsLink } from "@/components/farms";
import { LogoutButton } from "@/components/logout-button";
import { SyncBadge } from "@/components/sync-status";
import { Link, redirect } from "@/i18n/navigation";
import { can } from "@/lib/permissions";
import { listLegalEntities } from "@/modules/farm-registry";
import { thresholdTracker } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

// Empty until farms exist (T10).
export default function Dashboard() {
  return (
    <>
      <header className="flex justify-end p-4">
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-4">
        <Suspense>
          <Content />
        </Suspense>
      </main>
    </>
  );
}

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const [entity] = await listLegalEntities(ctx.value);
  // FN17: from 90 % of the exemption threshold, the owner and the manager see it first thing.
  const tracker = can(ctx.value, "finance.record") ? await thresholdTracker(ctx.value) : null;
  const nearThreshold = tracker?.ok && tracker.value?.usage.alert ? tracker.value.usage.percent : null;
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{entity?.name}</h1>
        {entity && <p className="opacity-75">{t(`Onboarding.forms.${entity.form}`)}</p>}
      </div>
      {nearThreshold !== null && (
        <Link href="/threshold" role="alert" className="rounded-lg border border-red-700/60 p-3 font-semibold">
          {t("Threshold.alert", { percent: String(nearThreshold) })}
        </Link>
      )}
      <SyncBadge userId={ctx.value.userId} organizationId={ctx.value.organizationId} role={ctx.value.role} />
      <FarmsLink userId={ctx.value.userId} organizationId={ctx.value.organizationId} />
      <Link href="/batches" className="underline underline-offset-4">{t("Batches.open")}</Link>
      <Link href="/protocol" className="underline underline-offset-4">{t("Protocol.open")}</Link>
      <Link href="/stock" className="underline underline-offset-4">{t("Stock.open")}</Link>
      {can(ctx.value, "sales.manage") && <Link href="/receivables" className="underline underline-offset-4">{t("Receivables.open")}</Link>}
      {can(ctx.value, "finance.record") && <Link href="/expenses" className="underline underline-offset-4">{t("Expenses.open")}</Link>}
      {can(ctx.value, "finance.record") && <Link href="/treasury" className="underline underline-offset-4">{t("Treasury.open")}</Link>}
      {can(ctx.value, "finance.record") && <Link href="/results" className="underline underline-offset-4">{t("Results.open")}</Link>}
      {can(ctx.value, "finance.record") && <Link href="/budget" className="underline underline-offset-4">{t("Budget.open")}</Link>}
      {can(ctx.value, "finance.record") && <Link href="/books" className="underline underline-offset-4">{t("Books.open")}</Link>}
      {can(ctx.value, "finance.record") && <Link href="/threshold" className="underline underline-offset-4">{t("Threshold.open")}</Link>}
      <Link href="/visitors" className="underline underline-offset-4">{t("Visitors.open")}</Link>
      <Link href="/inbox" className="underline underline-offset-4">{t("Inbox.open")}</Link>
      {can(ctx.value, "members.manage") && (
        <Link href="/settings/members" className="underline underline-offset-4">{t("Members.title")}</Link>
      )}
      <LogoutButton />
      <LogoutButton everywhere />
    </>
  );
}
