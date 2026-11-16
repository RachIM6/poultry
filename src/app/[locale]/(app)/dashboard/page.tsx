import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SyncBadge } from "@/components/sync-status";
import { Today } from "@/components/today";
import { Link, redirect } from "@/i18n/navigation";
import { can } from "@/lib/permissions";
import { listLegalEntities } from "@/modules/farm-registry";
import { thresholdTracker } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

// "Aujourd'hui" (tasks/plan-ui.md U3, Today.dc.html): the batches and the day's tasks, from the phone's database.
export default function Dashboard() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const { userId, organizationId, role } = ctx.value;
  const [entity] = await listLegalEntities(ctx.value);
  // FN17: from 90 % of the exemption threshold, the owner and the manager see it first thing.
  const tracker = can(ctx.value, "finance.record") ? await thresholdTracker(ctx.value) : null;
  const nearThreshold = tracker?.ok && tracker.value?.usage.alert ? tracker.value.usage.percent : null;
  return (
    <Today
      title={entity?.name ?? t("App.name")}
      userId={userId}
      organizationId={organizationId}
      sync={<SyncBadge userId={userId} organizationId={organizationId} role={role} />}
      alert={
        nearThreshold !== null && (
          <Link href="/threshold" role="alert" className="rounded-2xl bg-alert-soft p-4 font-semibold text-alert-fg">
            {t("Threshold.alert", { percent: String(nearThreshold) })}
          </Link>
        )
      }
    />
  );
}
