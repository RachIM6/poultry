"use client";

import { useTranslations } from "next-intl";
import { formatCount, formatDecimal } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { birdsOnHand, birdsStarted, houseFigure, type BatchDto, type DailyEntryDto, type SoldBirdsDto, type WeighingDto } from "@/modules/flock/shared";

/**
 * SPEC-m3 B9: a turkey lot placed "sexes séparés" shows both sexes side by side (same house, same placement day), each
 * with its birds and cumulative FCR; the other sex's card opens its own day. Its own chunk: the /batches budget.
 */
export function TurkeySexes({ batch, batches, entries, weighings, sold }: { batch: BatchDto; batches: BatchDto[]; entries: DailyEntryDto[]; weighings: WeighingDto[]; sold: SoldBirdsDto[] }) {
  const t = useTranslations();
  const pair = batches
    .filter((b) => b.houseId === batch.houseId && b.species === batch.species && b.placedOn === batch.placedOn && b.sex && b.sex !== "mixed")
    .sort((a, b) => a.sex!.localeCompare(b.sex!)); // female, then male
  if (pair.length < 2) return null;
  return (
    <section aria-labelledby="sexes-title" className="flex flex-col gap-2">
      <h3 id="sexes-title" className="text-[17px] font-semibold text-ink-2">{t("Batches.sexPair")}</h3>
      <div className="grid grid-cols-2 gap-2">
        {pair.map((b) => {
          const own = <T extends { batchId: string }>(xs: T[]) => xs.filter((x) => x.batchId === b.id);
          const f = houseFigure(
            { placedOn: b.placedOn as FarmDay, birdsStarted: birdsStarted(b), dayOldWeightGrams: b.dayOldWeightGrams, ageAtPlacementDays: b.ageAtPlacementDays, species: b.species },
            own(entries),
            own(weighings),
            (b.closedOn ?? farmDayOf(new Date())) as FarmDay, // a closed sex: as it ended
            own(sold),
          );
          const body = (
            <>
              <span className="font-semibold capitalize">{t(`Batches.sexes.${b.sex!}`)}</span>
              <span>{b.status === "closed" ? t("Batches.status.closed") : t("Today.birds", { count: formatCount(birdsOnHand(birdsStarted(b), own(entries), own(sold))) })}</span>
              <span>{t("Today.fcr", { fcr: f ? formatDecimal(f.value, 2) : "—" })}</span>
            </>
          );
          const box = "flex min-h-11 flex-col gap-0.5 rounded-[14px] bg-card px-3 py-2.5";
          return b.id === batch.id ? (
            <div key={b.id} aria-current="true" className={`${box} border-2 border-ink`}>{body}</div>
          ) : (
            <a key={b.id} href={`#${b.id}`} className={`${box} border border-line underline-offset-4 hover:underline`}>{body}</a>
          );
        })}
      </div>
    </section>
  );
}
