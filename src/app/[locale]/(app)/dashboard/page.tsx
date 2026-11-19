import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SyncBadge } from "@/components/sync-status";
import { Today } from "@/components/today";
import { Link, redirect } from "@/i18n/navigation";
import { can } from "@/lib/permissions";
import { listLegalEntities } from "@/modules/farm-registry";
import { batchResults, thresholdTracker, treasuryOverview } from "@/modules/finance";
import { formatMoney } from "@/lib/format";
import { farmDayOf } from "@/lib/kernel/farm-day";
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
  const tracker = can(ctx.value, "money.read") ? await thresholdTracker(ctx.value) : null;
  const nearThreshold = tracker?.ok && tracker.value?.usage.alert ? tracker.value.usage.percent : null;
  // WebOverview.dc.html "Argent": the cash at hand and the last closed batch, for those who see money (FX2).
  let money: React.ReactNode = null;
  if (can(ctx.value, "money.read")) {
    const [treasury, results] = await Promise.all([treasuryOverview(ctx.value, farmDayOf(new Date()).slice(0, 7)), batchResults(ctx.value)]);
    const cash = treasury.ok ? treasury.value.accounts.reduce((sum, a) => sum + a.balanceCentimes, 0n) : null;
    const last = results.ok ? results.value.filter((r) => r.closedOn).sort((a, b) => b.closedOn!.localeCompare(a.closedOn!))[0] : undefined;
    const row = "flex items-baseline justify-between gap-3 border-t border-shell/15 py-2.5 first:border-t-0";
    money = (
      <section aria-labelledby="money-title" className="flex flex-col rounded-[18px] bg-ink px-5 py-4 text-shell">
        <h2 id="money-title" className="mb-1 text-lg font-semibold">{t("Today.money")}</h2>
        {cash !== null && (
          <Link href="/treasury" className={row}>
            <span className="text-sm">{t("Today.cash")}</span>
            <b className="text-lg font-semibold">{formatMoney(cash)}</b>
          </Link>
        )}
        {last && last.costPerKgCentimes !== null && (
          <Link href="/results" className={row}>
            <span className="flex flex-col">
              <span className="text-sm">{t("Today.lastBatch", { house: last.houseName })}</span>
              <span className="text-xs text-sand">{t("Today.margin", { margin: formatMoney(last.marginCentimes) })}</span>
            </span>
            <b className="text-lg font-semibold">{t("Today.costPerKg", { cost: formatMoney(last.costPerKgCentimes) })}</b>
          </Link>
        )}
      </section>
    );
  }
  return (
    <Today
      title={entity?.name ?? t("App.name")}
      userId={userId}
      organizationId={organizationId}
      sync={<SyncBadge userId={userId} organizationId={organizationId} role={role} />}
      money={money}
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
