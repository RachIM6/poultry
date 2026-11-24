import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { thresholdTracker } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { BackLink } from "@/components/app-nav";

// SPEC-finance FN17: this fiscal year's agricultural sales against the exemption threshold. Online, owner and manager.
export default function ThresholdPage() {
  return (
    <>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <Tracker />
        </Suspense>
      </main>
    </>
  );
}

async function Tracker() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const tracker = await thresholdTracker(ctx.value);
  if (!tracker.ok) return <p>{t("Expenses.forbidden")}</p>;
  if (!tracker.value) return <p>{t("Threshold.none")}</p>;
  const { threshold, fiscalYear, bookedCentimes, plannedCentimes, usage, history } = tracker.value;
  const day = (d: string) => formatDay(d as FarmDay, lang);
  const width = `${Math.min(100, Number(usage.percent))}%`;
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("Threshold.title", { amount: formatMoney(threshold.centimes) })}</h1>
      <p className="text-muted">{lang === "ar" ? threshold.ruleAr : threshold.ruleFr}</p>
      {usage.alert && (
        <p role="alert" className="rounded-2xl bg-alert-soft p-3 font-semibold text-alert-fg">
          {t(usage.over ? "Threshold.over" : "Threshold.alert", { percent: String(usage.percent) })}
        </p>
      )}
      <section className="flex flex-col gap-2" aria-label={t("Threshold.year", { from: day(fiscalYear.from), to: day(fiscalYear.to) })}>
        <h2 className="text-[17px] font-semibold text-ink-2">{t("Threshold.year", { from: day(fiscalYear.from), to: day(fiscalYear.to) })}</h2>
        <div className="h-3 w-full rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(usage.percent)}>
          <div className={`h-3 rounded-full ${usage.alert ? "bg-alert" : "bg-olive"}`} style={{ width }} />
        </div>
        <dl className="grid grid-cols-2 gap-2">
          <dt>{t("Threshold.booked")}</dt>
          <dd className="text-end tabular-nums"><bdi dir="ltr">{formatMoney(bookedCentimes)}</bdi></dd>
          <dt>{t("Threshold.planned")}</dt>
          <dd className="text-end tabular-nums"><bdi dir="ltr">{formatMoney(plannedCentimes)}</bdi></dd>
          <dt className="font-semibold">{t("Threshold.total")}</dt>
          <dd className="text-end font-semibold tabular-nums"><bdi dir="ltr">{formatMoney(usage.totalCentimes)} · {String(usage.percent)} %</bdi></dd>
        </dl>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-[17px] font-semibold text-ink-2">{t("Threshold.history")}</h2>
        <ul className="flex flex-col gap-1" aria-label={t("Threshold.history")}>
          {history.map((h) => (
            <li key={h.from} className="flex justify-between gap-4">
              <span>{day(h.from)} – {day(h.to)}</span>
              <span className={`tabular-nums ${h.over ? "font-semibold text-alert" : ""}`}>
                <bdi dir="ltr">{formatMoney(h.bookedCentimes)}</bdi>{h.over ? ` · ${t("Threshold.overShort")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
