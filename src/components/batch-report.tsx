"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { primary } from "@/components/ui";
import { formatCount, formatDay, formatDecimal, formatKg, formatMoney, formatPercent } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import type { HouseDto } from "@/modules/farm-registry/schema";
import type { BatchDto, DailyEntryDto, SoldBirdsDto, WeighingDto } from "@/modules/flock/shared";
import type { TreatmentDto, VaccinationDto } from "@/modules/health/shared";
import { buildBatchReport, type BatchReport, type ResultRow } from "@/modules/reporting/shared";
import { currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { startSync } from "@/offline/sync";

// SPEC-m2-compliance RP3: the batch report (SCOPE §13), from the phone's records and finance's result.

const ENTITIES = ["house", "batch", "dailyEntry", "weighing", "soldBirds", "vaccination", "treatment"];

export function BatchReportView({ batchId, results }: { batchId: string; results: ResultRow[] }) {
  const scope = useLiveQuery(() => currentScope().then((s) => s ?? null), [], undefined);
  if (!scope) return null; // the server page already checked the session
  return <Report key={scopeKey(scope)} scope={scope} batchId={batchId} results={results} />;
}

function Report({ scope, batchId, results }: { scope: Scope; batchId: string; results: ResultRow[] }) {
  const { userId, organizationId, role } = scope;
  const t = useTranslations("Report");
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf(ENTITIES).toArray(), [userId, organizationId]);
  if (!records) return null;
  const all = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const batches = all<BatchDto>("batch");
  const batch = batches.find((b) => b.id === batchId);
  if (!batch) return <p>{t("notFound")}</p>;
  const report = buildBatchReport({
    batch,
    today: farmDayOf(new Date()),
    batches,
    entries: all<DailyEntryDto>("dailyEntry"),
    weighings: all<WeighingDto>("weighing"),
    sold: all<SoldBirdsDto>("soldBirds"),
    vaccinations: all<VaccinationDto>("vaccination"),
    treatments: all<TreatmentDto>("treatment"),
    results,
  });
  return <ReportDocument batch={batch} house={all<HouseDto>("house").find((h) => h.id === batch.houseId)} report={report} />;
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col border border-line p-2 print:border-black">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

function ReportDocument({ batch, house, report: r }: { batch: BatchDto; house: HouseDto | undefined; report: BatchReport }) {
  const t = useTranslations("Report");
  const locale = useLocale();
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const money = (c: string | null) => (c === null ? "—" : formatMoney(BigInt(c)));
  const fcr = (x: number | null) => (x === null ? "—" : formatDecimal(x, 2));
  const permille = (p: string | null) => (p === null ? "—" : `${formatPercent(Number(p) / 10)} %`);
  const k = r.kpis;

  return (
    <article className="flex flex-col gap-4">
      <header className="border-b-2 border-ink pb-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p>{t("subtitle", { house: house?.name ?? "—", date: day(batch.placedOn) })}</p>
        <p className="text-ink-2">{batch.status === "closed" && batch.closedOn ? t("closed", { date: day(batch.closedOn) }) : t("open")}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("production")}</h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
          <Figure label={t("age")}>{t("days", { days: k.ageDays })}</Figure>
          <Figure label={t("placed")}>{formatCount(k.placed)}</Figure>
          <Figure label={t("dead")}>{formatCount(k.dead)} · {formatPercent(k.mortalityPercent)} %</Figure>
          <Figure label={t("sold")}>{formatCount(k.sold)} · {formatKg(k.soldGrams)}</Figure>
          <Figure label={t("feed")}>{formatKg(k.feedGrams)}</Figure>
          <Figure label={t("fcr")}>{fcr(k.fcr)}</Figure>
          <Figure label={t("weight")}>{k.weighed ? formatKg(k.weighed.averageGrams) : "—"}</Figure>
          <Figure label={t("epef")}>{k.weighed?.epef == null ? "—" : formatCount(Math.round(k.weighed.epef))}</Figure>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("health")}</h2>
        <p>
          {t("vaccines", { done: r.health.vaccinesDone, planned: r.health.vaccinesPlanned })} · {t("treatments", { count: r.health.treatments })}
          {r.health.lastWithdrawalEnd && ` · ${t("withdrawalEnd", { date: day(r.health.lastWithdrawalEnd) })}`}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("money")}</h2>
        {r.money ? (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 print:grid-cols-3">
            <Figure label={t("sales")}>{money(r.money.salesCentimes)}</Figure>
            <Figure label={t("cost")}>{money(r.money.costCentimes)}</Figure>
            <Figure label={t("margin")}>{money(r.money.marginCentimes)}</Figure>
            <Figure label={t("costPerKg")}>{money(r.money.costPerKgCentimes)}</Figure>
            <Figure label={t("marginPerKg")}>{money(r.money.marginPerKgCentimes)}</Figure>
            <Figure label={t("share")}>{permille(r.money.marginPermille)}</Figure>
          </dl>
        ) : (
          <p>{t("noResult")}</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("comparison")}</h2>
        <table className="w-full text-sm" aria-label={t("comparison")}>
          <thead>
            <tr className="text-ink-2">
              <th className="p-1 text-start">{t("batch")}</th>
              <th className="p-1 text-end">{t("mortality")}</th>
              <th className="p-1 text-end">{t("fcr")}</th>
              <th className="p-1 text-end">{t("costPerKg")}</th>
              <th className="p-1 text-end">{t("marginPerKg")}</th>
            </tr>
          </thead>
          <tbody>
            {r.comparison.map((c) => (
              <tr key={c.id} className={`border-t border-line ${c.id === batch.id ? "font-semibold" : ""}`}>
                <td className="p-1">{day(c.placedOn)}</td>
                <td className="p-1 text-end">{formatPercent(c.mortalityPercent)} %</td>
                <td className="p-1 text-end">{fcr(c.fcr)}</td>
                <td className="p-1 text-end">{money(c.costPerKgCentimes)}</td>
                <td className="p-1 text-end">{money(c.marginPerKgCentimes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <button type="button" onClick={() => window.print()} className={`${primary} print:hidden`}>{t("print")}</button>
    </article>
  );
}
