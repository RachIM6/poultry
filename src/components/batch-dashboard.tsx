"use client";

import { useTranslations } from "next-intl";
import { formatDecimal, formatKg, formatMoney, formatPercent } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { ageOfBatch, batchKpis, birdsOnHand, birdsStarted, doaClaim, liveCostPerKg, shownFcrEpef, waterPerFeed, versusStandard, type BatchDto, type DailyEntryDto, type SoldBirdsDto, type WeighingDto } from "@/modules/flock/shared";
import type { CurvePoint, ReferenceData } from "@/modules/reference-data/schema";
import { curveFor, standardAt } from "@/modules/reference-data/shared";

type StrainCurves = ReferenceData["strains"][number]["curves"];
import { card, warn } from "@/components/ui";
import { BatchStrip, type StripDay } from "@/components/batch-strip";
import { useBatchResults } from "@/components/batch-results";

// SPEC B4 on the phone: the batch's KPIs from its local records, so they work offline and change as soon as a day or
// a weighing is saved. Weight-based KPIs wait for a weighing; the standard is shown only when the strain has a curve.

const today = () => farmDayOf(new Date());

export function BatchDashboard({
  batch,
  entries,
  weighings,
  sold,
  curves,
  money = false,
}: {
  batch: BatchDto;
  entries: DailyEntryDto[];
  weighings: WeighingDto[];
  sold: SoldBirdsDto[];
  curves: StrainCurves; // the strain's; this batch's sex picks one (SPEC-m3 R6)
  money?: boolean; // money.read: the live cost per kg tile (never workers nor vets, I5)
}) {
  const curve = curveFor(curves, batch.sex ?? "mixed")?.points ?? null;
  const t = useTranslations();
  const placedOn = batch.placedOn as FarmDay;
  const started = { placedOn, birdsStarted: birdsStarted(batch), dayOldWeightGrams: batch.dayOldWeightGrams, ageAtPlacementDays: batch.ageAtPlacementDays };
  const k = batchKpis(started, entries, weighings, (batch.closedOn as FarmDay | undefined) ?? today(), sold); // a closed batch: as it ended
  const w = k.weighed;
  const { fcr, epef, avgWeightGrams } = shownFcrEpef({ ...started, status: batch.status, closedOn: batch.closedOn }, w, entries, sold); // closed: feed ÷ kg sold, as /compare
  const standard = w && curve ? standardAt(curve, w.ageDays) : null;
  const none = "—";
  const water = waterPerFeed(entries);
  // Batch.dc.html's cost per kg while the batch is open: FN13's costs so far (the server's, as /results), over the
  // estimated live weight. Online only; a closed batch shows its cost per kg sold instead (ClosedSummary).
  const live = money && batch.status === "open";
  const result = useBatchResults(live, `${batch.id}:${weighings.length}`)?.find((r) => r.id === batch.id);
  const birds = birdsOnHand(birdsStarted(batch), entries, sold);
  const cost = result ? BigInt(result.costCentimes) : null;
  const perKg = cost !== null && w ? liveCostPerKg(cost, birds, w.averageGrams) : null;
  const tiles: [string, string, string?][] = [
    [t("Kpi.mortality"), `${formatPercent(k.mortalityPercent)} %`],
    [t("Kpi.feedPerBird"), k.feedPerBirdGrams === null ? none : formatKg(Math.round(k.feedPerBirdGrams))],
    [t("Kpi.waterFeed"), water ? formatDecimal(water.ratio, 1) : none, water ? t("Kpi.waterFeedOn", { day: String(ageOfBatch(batch, water.day as FarmDay)) }) : undefined], // SPEC-m3 B14
    batch.status === "closed" ? [t("Kpi.weightSold"), avgWeightGrams === null ? none : formatKg(Math.round(avgWeightGrams))] : [
      w ? t("Kpi.weight", { age: String(w.ageDays) }) : t("Kpi.weightNone"),
      w ? formatKg(w.averageGrams) : none,
      w ? (standard ? t("Weighing.versusStandard", { gap: formatPercent(versusStandard(w.averageGrams, standard.bodyWeightGrams), true), standard: formatKg(standard.bodyWeightGrams) }) : t("Weighing.noStandard")) : undefined,
    ],
    [t("Kpi.fcr"), fcr === null ? none : formatDecimal(fcr, 2)],
    [t("Kpi.epef"), epef === null ? none : formatDecimal(epef, 0)],
    [t("Kpi.dailyGain"), w?.dailyGainGrams == null ? none : t("Kpi.gramsPerDay", { grams: formatDecimal(w.dailyGainGrams, 1) })],
  ];
  if (live)
    tiles.push([
      t("Kpi.costPerKg"),
      perKg === null ? none : t("Kpi.costPerKgValue", { cost: formatMoney(perKg) }),
      perKg !== null && w
        ? t("Kpi.costPerKgNote", { cost: formatMoney(cost!), kg: formatKg(birds * w.averageGrams) })
        : t(cost === null ? "Kpi.costOffline" : !w ? "Kpi.costNoWeighing" : "Kpi.costNone"),
    ]);

  // One point per weighing day: the latest of that day, as the KPIs use.
  const byDay = new Map([...weighings].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id)).map((x) => [x.day, x]));
  const points = [...byDay.values()].map((x) => ({ age: ageOfBatch(batch, x.day as FarmDay), grams: Math.round(x.totalGrams / x.count) }));

  return (
    // WebBatch.dc.html: on wide screens the chart and the tiles sit side by side.
    <section className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-x-5" aria-labelledby="kpi-title">
      <h3 id="kpi-title" className="text-[17px] font-semibold text-ink-2 lg:col-span-full">{t("Kpi.title")}</h3>
      {points.length > 0 && <GrowthChart points={points} curve={curve} />}
      <dl className={`grid grid-cols-2 gap-2 ${points.length > 0 ? "" : "lg:col-span-full lg:grid-cols-4"}`}>
        {tiles.map(([label, value, note]) => (
          <div key={label} className="flex flex-col gap-0.5 rounded-[14px] bg-card px-3 py-2.5">
            <dt className="text-[13px] text-ink-2">{label}</dt>
            <dd className="text-xl font-semibold"><bdi>{value}</bdi></dd>
            {note && <dd className="text-xs font-medium text-muted">{note}</dd>}
          </div>
        ))}
      </dl>
      {result?.hens && <p className="text-sm text-muted lg:col-span-full">{t(`Kpi.hens_${result.hens.basis}`, { amount: formatMoney(BigInt(result.hens.centimes)) })}</p>}
      <p className="text-sm text-muted lg:col-span-full">{batch.status === "closed" ? t("Kpi.atClosing", { age: String(k.ageDays) }) : w ? t("Kpi.atWeighing", { age: String(w.ageDays) }) : t("Kpi.weighFirst")}</p>
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
    <figure className={card}>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
        <span className="me-auto text-base font-semibold">{t("chart")}</span>
        <span className="flex items-center gap-1">
          <svg width="20" height="8" aria-hidden="true"><line x1="0" y1="4" x2="20" y2="4" strokeWidth="3" className="stroke-ink" /></svg>
          {t("flock")}
        </span>
        {std.length > 1 && (
          <span className="flex items-center gap-1">
            <svg width="20" height="8" aria-hidden="true"><line x1="0" y1="4" x2="20" y2="4" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" className="stroke-muted" /></svg>
            {t("standard")}
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" direction="ltr" role="img" aria-label={t("chartLabel", { points: points.map((p) => `${t("day", { age: String(p.age) })} ${formatKg(p.grams)}`).join(", ") })}>
        {[0, top / 2, top].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} strokeWidth="1" className="stroke-line" />
            <text x={L - 4} y={y(g) + 3} textAnchor="end" fontSize="10" className="fill-muted">{formatKg(g)}</text>
          </g>
        ))}
        <text x={x(0)} y={H - 6} fontSize="10" className="fill-muted">{t("day", { age: "0" })}</text>
        <text x={x(maxAge)} y={H - 6} fontSize="10" textAnchor="end" className="fill-muted">{t("day", { age: String(maxAge) })}</text>
        {std.length > 1 && <polyline points={line(std)} fill="none" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" className="stroke-muted" />}
        {points.length > 1 && <polyline points={line(points)} fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="stroke-ink" />}
        {points.map((p) => (
          <g key={p.age}>
            <circle cx={x(p.age)} cy={y(p.grams)} r="4" strokeWidth="2" className="fill-chick stroke-ink" />
            <circle cx={x(p.age)} cy={y(p.grams)} r="12" fill="transparent">
              <title>{`${t("day", { age: String(p.age) })} : ${formatKg(p.grams)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
    </figure>
  );
}

// Batch.dc.html: a round back button and the batch's name, then a dark card with its day and strip.
export function BatchHeader({ title }: { title: string }) {
  const t = useTranslations("Day");
  return (
    <div className="flex items-center gap-3">
      <a href="#" aria-label={t("back")} className="grid size-11 shrink-0 place-items-center rounded-[14px] border border-line bg-card">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rtl:-scale-x-100">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </a>
      <h2 className="text-[21px] font-semibold leading-tight">{title}</h2>
    </div>
  );
}

export function OpenBatchCard({ strip, ageLabel, birds, next }: { strip: { age: number; days: StripDay[]; label: string }; ageLabel?: string; birds: string; next: string | null }) {
  const t = useTranslations();
  return (
    <section aria-label={strip.label} className="flex flex-col gap-2.5 rounded-[20px] bg-ink p-4 text-shell">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[26px] font-semibold">
          {ageLabel ?? (
            <>
              {t("Batches.age", { age: String(strip.age) })} <span className="text-base font-normal text-sand">/ {strip.days.length}</span>
            </>
          )}
        </span>
        <span className="text-sm text-sand">{birds}</span>
      </div>
      <BatchStrip days={strip.days} onDark label={strip.label} />
      {next && <span className="text-sm text-sand">{t("Batches.nextVaccine", { vaccine: next })}</span>}
    </section>
  );
}

/** SPEC-m3 B10 under the batch's card: the density and a hatchery claim (B9's other sex: turkey-sexes.tsx). */
export function BatchNotes({
  batch,
  areaM2,
  claimPermille,
}: {
  batch: BatchDto;
  areaM2: number | undefined;
  claimPermille: number | null | undefined;
}) {
  const t = useTranslations();
  return (
    <>
      {areaM2 && <p>{t("Batches.density", { density: formatDecimal(birdsStarted(batch) / areaM2, 1) })}</p>}
      {doaClaim(batch, claimPermille) && <p role="alert" className={warn}>{t("Batches.claim")}</p>}
    </>
  );
}
