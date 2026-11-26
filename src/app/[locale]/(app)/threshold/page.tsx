import { headers } from "next/headers";
import { locale } from "next/root-params";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { thresholdTracker } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { sectionTitle, splitAside, splitNarrow } from "@/components/layout";
import { Page } from "@/components/page";
import { ResultsTabs } from "../results/results-tabs";

// SPEC-finance FN17: this fiscal year's agricultural sales against the exemption threshold. Online, owner and manager.
// The section's title and tabs are static; the tracker streams in under them, its threshold as its first heading.
export default function ThresholdPage() {
  const t = useTranslations("Results");
  return (
    <Page width="wide" back="/more" title={t("section")} nav={<ResultsTabs current="threshold" />}>
      <Suspense>
        <Tracker />
      </Suspense>
    </Page>
  );
}

async function Tracker() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const tracker = await thresholdTracker(ctx.value);
  if (!tracker.ok || !tracker.value) return <p>{t(tracker.ok ? "Threshold.none" : "Threshold.forbidden")}</p>;
  const { threshold, fiscalYear, bookedCentimes, plannedCentimes, usage, history } = tracker.value;
  const day = (d: string) => formatDay(d as FarmDay, lang);
  const width = `${Math.min(100, Number(usage.percent))}%`;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className={sectionTitle}>{t("Threshold.title", { amount: formatMoney(threshold.centimes) })}</h2>
        <p className="text-sm text-ink-2">{lang === "ar" ? threshold.ruleAr : threshold.ruleFr}</p>
      </div>
      {usage.alert && (
        <p role="alert" className="rounded-2xl bg-alert-soft p-3 font-semibold text-alert-fg">
          {t(usage.over ? "Threshold.over" : "Threshold.alert", { percent: String(usage.percent) })}
        </p>
      )}
      {/* Wide screens: this year, and the last three beside it. */}
      <div className={splitNarrow}>
        <section className="flex flex-col gap-2" aria-labelledby="threshold-year">
          <h2 id="threshold-year" className={sectionTitle}>{t("Threshold.year", { from: day(fiscalYear.from), to: day(fiscalYear.to) })}</h2>
          {/* aria-valuenow stays within its max; the text says the real share, over 100 % too */}
          <div className="h-3 w-full rounded-full bg-line" role="progressbar" aria-labelledby="threshold-year" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Number(usage.percent))} aria-valuetext={`${String(usage.percent)} %`}>
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
        <section className={`flex flex-col gap-2 ${splitAside}`}>
          <h2 className={sectionTitle}>{t("Threshold.history")}</h2>
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
      </div>
    </>
  );
}
