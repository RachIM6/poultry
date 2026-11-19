"use client";

import { useTranslations } from "next-intl";
import { card } from "@/components/ui";
import { formatCount, formatDecimal, formatPercent } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { layerKpis, type EggCollectionDto } from "@/modules/eggs/shared";
import { birdsStarted, type BatchDto, type DailyEntryDto, type SoldBirdsDto } from "@/modules/flock/shared";
import { layingStandardAt } from "@/modules/reference-data/shared";
import type { LayingFile } from "@/modules/reference-data/schema";

// SPEC-m3 E5 on a layer batch's screen (P-Layers): the figures from its local records, and the laying standard of its
// strain when one is loaded (MQ1: none yet).

const today = () => farmDayOf(new Date());
const SHOWN_WEEKS = 5;

export function LayerDashboard({
  batch,
  entries,
  sold,
  collections,
  curve,
}: {
  batch: BatchDto;
  entries: DailyEntryDto[];
  sold: SoldBirdsDto[];
  collections: EggCollectionDto[];
  curve: LayingFile["points"] | null;
}) {
  const t = useTranslations();
  const end = (batch.closedOn as FarmDay | undefined) ?? today();
  const k = layerKpis({ placedOn: batch.placedOn as FarmDay, ageAtPlacementDays: batch.ageAtPlacementDays, hensHoused: birdsStarted(batch) }, entries, sold, collections, end);
  const week = k.weeks.at(-1)?.week;
  const std = curve && week !== undefined ? layingStandardAt(curve, week) : null;
  const none = "—";
  const pct = (n: number | null) => (n === null ? none : `${formatPercent(n)} %`);
  const grams = (n: number | null) => (n === null ? none : `${formatDecimal(n, 1)} g`);
  const tiles: [string, string, string?][] = [
    [t("Layers.hens"), formatCount(k.hensOnHand), t("Layers.mortality", { percent: formatPercent(k.mortalityPercent) })],
    [t("Layers.rate"), pct(k.lastDay?.layingRate ?? null), std?.layingRatePermille != null ? t("Layers.standard", { value: `${formatPercent(std.layingRatePermille / 10)} %` }) : t("Layers.noStandard")],
    [t("Layers.perHenHoused"), formatDecimal(k.eggsPerHenHoused, 1), std?.eggsPerHenHousedTenths != null ? t("Layers.standard", { value: formatDecimal(std.eggsPerHenHousedTenths / 10, 1) }) : undefined],
    [t("Layers.eggWeight"), grams(k.eggWeightGrams), std?.eggWeightDg != null ? t("Layers.standard", { value: grams(std.eggWeightDg / 10) }) : undefined],
    [t("Layers.feedPerEgg"), k.feedPerEggGrams === null ? none : `${formatDecimal(k.feedPerEggGrams, 0)} g`],
    [t("Layers.downgraded"), pct(k.downgradedPercent)],
  ];

  return (
    <section className="flex flex-col gap-3" aria-labelledby="layers-title">
      <h3 id="layers-title" className="text-lg font-semibold">{t("Kpi.title")}</h3>
      <dl className="grid grid-cols-2 gap-3">
        {tiles.map(([label, value, note]) => (
          <div key={label} className={card}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{value}</dd>
            {note && <dd className="text-sm text-muted">{note}</dd>}
          </div>
        ))}
      </dl>
      {k.weeks.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm tabular-nums">
            <caption className="mb-2 text-start font-semibold">{t("Layers.weeks")}</caption>
            <thead>
              <tr className="text-muted">
                {["week", "hens", "rate", "eggWeight", "feedPerHen", "waterFeed", "downgradedShort"].map((c) => (
                  <th key={c} scope="col" className="p-2 text-start font-medium">{t(`Layers.cols.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {k.weeks.slice(-SHOWN_WEEKS).map((w) => (
                <tr key={w.week} className="border-t border-line">
                  <td className="p-2 font-semibold">{w.week}</td>
                  <td className="p-2">{formatCount(w.hens)}</td>
                  <td className="p-2">{pct(w.layingRate)}</td>
                  <td className="p-2">{grams(w.eggWeightGrams)}</td>
                  <td className="p-2">{w.feedPerHenGrams === null ? none : formatDecimal(w.feedPerHenGrams, 0)}</td>
                  <td className="p-2">{w.waterPerFeed === null ? none : formatDecimal(w.waterPerFeed, 1)}</td>
                  <td className="p-2">{pct(w.downgradedPercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
