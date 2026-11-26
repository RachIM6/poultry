import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { SyncBadge } from "@/components/sync-status";
import { Today } from "@/components/today";
import { Figure } from "@/components/today-wide";
import { ClientMessages } from "@/i18n/client-messages";
import { Link, redirect } from "@/i18n/navigation";
import type { MessagePath } from "@/i18n/pick";
import { can } from "@/lib/permissions";
import { listLegalEntities, type LegalEntityDto } from "@/modules/farm-registry";
import { accountingChoicesOpen, batchResults, catchUpBooks, thresholdTracker, treasuryOverview } from "@/modules/finance";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { getTenantContext } from "@/modules/identity";
import { ChoicesBanner } from "./choices-banner";

// What this page's client components read (src/i18n/client-messages.tsx): Today, its SyncBadge and the ChoicesBanner.
// The money card and the threshold alert are server-rendered. No error codes: nothing here submits.
const MESSAGES: MessagePath[] = [
  "Accounting.choicesFirst", "Accounting.later", "Accounting.open", "Accounting.title", "App.name", "Batches.age",
  "Batches.ageWeeks", "Batches.ageWeeksDays", "Batches.place", "Batches.sexes", "Farms.none", "Farms.title",
  "Protocol.methods", "Strip", "Sync.pending", "Sync.refused", "Sync.upToDate", "Today", "Treatment.withdrawal", "Types",
  "Vaccination.status", "Weighing.uniformity", "Weighing.versusStandard",
];

// "Aujourd'hui" (tasks/plan-ui.md U3, Today.dc.html): the batches and the day's tasks, from the phone's database.
export default function Dashboard() {
  return (
    <ClientMessages paths={MESSAGES}>
      <Suspense>
        <Content />
      </Suspense>
    </ClientMessages>
  );
}

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const { userId, organizationId, role } = ctx.value;
  const [entity] = await listLegalEntities(ctx.value); // one read, shared with the sections below (React cache)
  // The day's tasks first: the money and the alerts stream in after, each on its own (SPEC-finance §9's reads are slow).
  return (
    <Today
      title={entity?.name ?? t("App.name")}
      userId={userId}
      organizationId={organizationId}
      role={role}
      sync={<SyncBadge userId={userId} organizationId={organizationId} role={role} />}
      // The wide home's cash tile (U18): the same read as the money card's first row, done once (cashAtHand).
      cash={
        can(ctx.value, "money.read") && (
          <Suspense fallback={<Figure label={t("Today.cash")} busy />}>
            <CashFigure ctx={ctx.value} />
          </Suspense>
        )
      }
      money={
        can(ctx.value, "money.read") && (
          <Suspense fallback={<MoneyCard title={t("Today.money")} busy />}>
            <Money ctx={ctx.value} />
          </Suspense>
        )
      }
      alert={
        <>
          {/* docs/data-requests.md: a left organisation is read-only until its deletion; the export goes through the operator */}
          {ctx.value.leftAt && (
            <p role="status" className="rounded-2xl bg-alert-soft p-4 font-semibold text-alert-fg">
              {t("Today.left", { day: formatDay(farmDayOf(new Date(ctx.value.leftAt)), lang) })}
            </p>
          )}
          <Suspense>
            <Alerts ctx={ctx.value} entity={entity} />
          </Suspense>
        </>
      }
    />
  );
}

// WebOverview.dc.html "Argent": the cash at hand and the last closed batch, for those who see money (FX2).
function MoneyCard({ title, busy, children }: { title: string; busy?: boolean; children?: React.ReactNode }) {
  return (
    <section aria-labelledby="money-title" aria-busy={busy} className="flex flex-col rounded-[18px] bg-ink px-5 py-4 text-shell">
      <h2 id="money-title" className="mb-1 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

// The cash at hand, read once per request for the money card and the wide home's tile (React cache, same ctx object).
const cashAtHand = cache(async (ctx: TenantContext) => {
  const treasury = await treasuryOverview(ctx, farmDayOf(new Date()).slice(0, 7));
  return treasury.ok ? treasury.value.accounts.reduce((sum, a) => sum + a.balanceCentimes, treasury.value.unassignedCentimes) : null;
});

async function CashFigure({ ctx }: { ctx: TenantContext }) {
  const [t, cash] = await Promise.all([getTranslations(), cashAtHand(ctx)]);
  if (cash === null) return null; // not read: no tile rather than a made-up figure
  return <Figure href="/treasury" label={t("Today.cash")} value={<span dir="ltr">{formatMoney(cash)}</span>} note={t("Today.seeCash")} />;
}

async function Money({ ctx }: { ctx: TenantContext }) {
  // Each read catches the books up first (SPEC-finance §9); catchUpBooks runs once for the page (React cache).
  const [t, cash, results] = await Promise.all([getTranslations(), cashAtHand(ctx), batchResults(ctx)]);
  const last = results.ok ? results.value.filter((r) => r.closedOn).sort((a, b) => b.closedOn!.localeCompare(a.closedOn!))[0] : undefined;
  const row = "flex items-baseline justify-between gap-3 border-t border-shell/15 py-2.5 first:border-t-0";
  return (
    <MoneyCard title={t("Today.money")}>
      {cash !== null && (
        <Link href="/treasury" className={row}>
          <span className="text-sm">{t("Today.cash")}</span>
          <b dir="ltr" className="text-lg font-semibold">{formatMoney(cash)}</b>
        </Link>
      )}
      {last && last.costPerKgCentimes !== null && (
        <Link href="/results" className={row}>
          <span className="flex flex-col">
            <span className="text-sm">{t("Today.lastBatch", { house: last.houseName })}</span>
            <span className="text-xs text-sand">{t("Today.margin", { margin: formatMoney(last.marginCentimes) })}</span>
          </span>
          <span className="flex flex-col items-end">
            <span className="text-xs text-sand">{t("Today.costPerKgLabel")}</span>
            <b className="whitespace-nowrap text-lg font-semibold">{t("Today.costPerKg", { cost: formatMoney(last.costPerKgCentimes) })}</b>
          </span>
        </Link>
      )}
    </MoneyCard>
  );
}

async function Alerts({ ctx, entity }: { ctx: TenantContext; entity: LegalEntityDto | undefined }) {
  await catchUpBooks(ctx); // SPEC-finance §9: before the tracker's and the choices' reads
  const [t, tracker, choicesOpen] = await Promise.all([
    getTranslations(),
    // FN17: from 90 % of the exemption threshold, the owner and the manager see it first thing.
    can(ctx, "money.read") ? thresholdTracker(ctx) : null,
    // FN1: the owner makes the accounting choices before the first entry locks them for the year.
    entity && accountingChoicesOpen(ctx, entity),
  ]);
  const nearThreshold = tracker?.ok && tracker.value?.usage.alert ? tracker.value.usage.percent : null;
  return (
    <>
      {nearThreshold !== null && (
        <Link href="/threshold" role="alert" className="rounded-2xl bg-alert-soft p-4 font-semibold text-alert-fg">
          {t("Threshold.alert", { percent: String(nearThreshold) })}
        </Link>
      )}
      {choicesOpen && <ChoicesBanner />}
    </>
  );
}
