"use client";

import { useTranslations } from "next-intl";
import { formatDecimal, formatKg, formatPercent } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { ageOn, batchKpis, versusStandard, type BatchDto, type DailyEntryDto, type WeighingDto } from "@/modules/flock/schema";
import { standardAt, type CurvePoint } from "@/modules/reference-data/schema";

// SPEC B4 on the phone: the batch's KPIs from its local records, so they work offline and change as soon as a day or
// a weighing is saved. Weight-based KPIs wait for a weighing; the standard is shown only when the strain has a curve.

const today = () => farmDayOf(new Date());

export function BatchDashboard({ batch, entries, weighings, curve }: { batch: BatchDto; entries: DailyEntryDto[]; weighings: WeighingDto[]; curve: readonly CurvePoint[] | null }) {
  const t = useTranslations();
  const placedOn = batch.placedOn as FarmDay;
  const k = batchKpis({ placedOn, birdsStarted: batch.chicksPlaced - batch.deadOnArrival, dayOldWeightGrams: batch.dayOldWeightGrams }, entries, weighings, today());
  const w = k.weighed;
  const standard = w && curve ? standardAt(curve, w.ageDays) : null;
  const none = "—";
  const tiles: [string, string, string?][] = [
    [t("Kpi.mortality"), `${formatPercent(k.mortalityPercent)} %`],
    [t("Kpi.feedPerBird"), k.feedPerBirdGrams === null ? none : formatKg(Math.round(k.feedPerBirdGrams))],
    [
      w ? t("Kpi.weight", { age: String(w.ageDays) }) : t("Kpi.weightNone"),
      w ? formatKg(w.averageGrams) : none,
      w ? (standard ? t("Weighing.versusStandard", { gap: formatPercent(versusStandard(w.averageGrams, standard.bodyWeightGrams), true), standard: formatKg(standard.bodyWeightGrams) }) : t("Weighing.noStandard")) : undefined,
    ],
    [t("Kpi.fcr"), w?.fcr == null ? none : formatDecimal(w.fcr, 2)],
    [t("Kpi.epef"), w?.epef == null ? none : formatDecimal(w.epef, 0)],
    [t("Kpi.dailyGain"), w?.dailyGainGrams == null ? none : t("Kpi.gramsPerDay", { grams: formatDecimal(w.dailyGainGrams, 1) })],
  ];

  // One point per weighing day: the latest of that day, as the KPIs use.
  const byDay = new Map([...weighings].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id)).map((x) => [x.day, x]));
  const points = [...byDay.values()].map((x) => ({ age: ageOn(placedOn, x.day as FarmDay), grams: Math.round(x.totalGrams / x.count) }));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="kpi-title">
      <h3 id="kpi-title" className="text-lg font-semibold">{t("Kpi.title")}</h3>
      <dl className="grid grid-cols-2 gap-3">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="flex flex-col gap-1 rounded-lg border border-current/20 p-3">
            <dt className="text-sm opacity-75">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{value}</dd>
            {note && <dd className="text-sm opacity-75">{note}</dd>}
          </div>
        ))}
      </dl>
      <p className="text-sm opacity-75">{w ? t("Kpi.atWeighing", { age: String(w.ageDays) }) : t("Kpi.weighFirst")}</p>
      {points.length > 0 && <GrowthChart points={points} curve={curve} />}
    </section>
  );
}

const W = 320, H = 180, L = 44, R = 10, T = 10, B = 24;

function GrowthChart({ points, curve }: { points: { age: number; grams: number }[]; curve: readonly CurvePoint[] | null }) {
  const t = useTranslations("Kpi");
  const maxAge = Math.max(7, ...points.map((p) => p.age));
  const std = (curve ?? []).filter((p) => p.day <= maxAge).map((p) => ({ age: p.day, grams: p.bodyWeightGrams }));
  const end = curve && std.at(-1)?.age !== maxAge ? standardAt(curve, maxAge) : null; // the curve, cut at the chart's edge
  if (end) std.push({ age: maxAge, grams: end.bodyWeightGrams });
  const top = Math.ceil((Math.max(...points.map((p) => p.grams), ...std.map((p) => p.grams)) * 1.1) / 500) * 500;
  const x = (age: number) => L + (age / maxAge) * (W - L - R);
  const y = (grams: number) => T + (1 - grams / top) * (H - T - B);
  const line = (ps: { age: number; grams: number }[]) => ps.map((p) => `${x(p.age)},${y(p.grams)}`).join(" ");

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold">{t("chart")}</span>
        <span className="flex items-center gap-1">
          <svg width="20" height="8" aria-hidden="true"><line x1="0" y1="4" x2="20" y2="4" strokeWidth="2" className="stroke-green-700 dark:stroke-green-600" /></svg>
          {t("flock")}
        </span>
        {std.length > 1 && (
          <span className="flex items-center gap-1">
            <svg width="20" height="8" aria-hidden="true"><line x1="0" y1="4" x2="20" y2="4" strokeWidth="2" strokeDasharray="4 3" className="stroke-current opacity-60" /></svg>
            {t("standard")}
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" direction="ltr" role="img" aria-label={t("chartLabel", { points: points.map((p) => `${t("day", { age: String(p.age) })} ${formatKg(p.grams)}`).join(", ") })}>
        {[0, top / 2, top].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} strokeWidth="1" className="stroke-current opacity-15" />
            <text x={L - 4} y={y(g) + 3} textAnchor="end" fontSize="10" className="fill-current opacity-70">{formatKg(g)}</text>
          </g>
        ))}
        <text x={x(0)} y={H - 6} fontSize="10" className="fill-current opacity-70">{t("day", { age: "0" })}</text>
        <text x={x(maxAge)} y={H - 6} fontSize="10" textAnchor="end" className="fill-current opacity-70">{t("day", { age: String(maxAge) })}</text>
        {std.length > 1 && <polyline points={line(std)} fill="none" strokeWidth="2" strokeDasharray="4 3" className="stroke-current opacity-60" />}
        {points.length > 1 && <polyline points={line(points)} fill="none" strokeWidth="2" strokeLinejoin="round" className="stroke-green-700 dark:stroke-green-600" />}
        {points.map((p) => (
          <g key={p.age}>
            <circle cx={x(p.age)} cy={y(p.grams)} r="4" strokeWidth="2" className="fill-green-700 stroke-background dark:fill-green-600" />
            <circle cx={x(p.age)} cy={y(p.grams)} r="12" fill="transparent">
              <title>{`${t("day", { age: String(p.age) })} : ${formatKg(p.grams)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
    </figure>
  );
}
