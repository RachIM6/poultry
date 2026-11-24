"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import type { Write } from "@/components/daily-entry";
import { useFieldError } from "@/components/focus";
import { formatCount, formatKg, formatPercent } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { Batch, FLOCK_MUTATIONS as M, ageOfBatch, sampleStats, uniformityPercent, versusStandard, type BatchDto, type Sample, type WeighingDto } from "@/modules/flock/shared";
import { parseQuantity } from "@/modules/inventory/shared";
import type { ReferenceData } from "@/modules/reference-data/schema";
import { curveFor, standardAt } from "@/modules/reference-data/shared";

type StrainCurves = ReferenceData["strains"][number]["curves"];
import { danger, field, primary } from "@/components/ui";

// SPEC B3 on the phone: type the sample, see the average, uniformity (CV%) and the gap to the strain standard at once.
// Without a published curve for the strain (OQ5) the gap is not shown: a standard is never guessed.

const today = () => farmDayOf(new Date());

/** The typed sample: weights in kg separated by spaces or new lines ("2,05 1,98"), or a group's total and count. */
function readSample(group: boolean, weights: string, total: string, count: string): Sample | null {
  if (group) {
    const totalGrams = parseQuantity(total, "kg");
    return totalGrams !== null && /^\d+$/.test(count.trim()) ? { totalGrams, count: Number(count) } : null;
  }
  const grams = weights.split(/[\s;]+/).filter(Boolean).map((p) => parseQuantity(p, "kg"));
  return grams.length > 0 && grams.every((g) => g !== null) ? { weightsGrams: grams as number[] } : null;
}

const asSample = (w: WeighingDto): Sample => (w.weightsGrams.length ? { weightsGrams: w.weightsGrams } : { totalGrams: w.totalGrams, count: w.count });

export function Weighings({ batch, weighings, curves, write }: { batch: BatchDto; weighings: WeighingDto[]; curves: StrainCurves; write: Write }) {
  const curve = curveFor(curves, batch.sex ?? "mixed")?.points ?? null; // R6: its sex's, else mixed
  const t = useTranslations();
  const [day, setDay] = useState<string>(today());
  const [group, setGroup] = useState(false);
  const [weights, setWeights] = useState("");
  const [total, setTotal] = useState("");
  const [count, setCount] = useState("");
  const { id: errorId, error, set: setError, field: bad } = useFieldError();
  const ids = { day: useId(), weights: useId(), total: useId(), count: useId() };
  const sample = readSample(group, weights, total, count);

  const describe = (s: Sample, onDay: string) => {
    const stats = sampleStats(s);
    const standard = curve && standardAt(curve, ageOfBatch(batch, onDay as FarmDay));
    return [
      t("Weighing.average", { average: formatKg(stats.averageGrams), count: formatCount(stats.count) }),
      stats.cvPercent === null ? null : t("Weighing.cv", { cv: formatPercent(stats.cvPercent) }),
      // SPEC-m3 B12: the guides' uniformity, for the types weighed weekly against a target (pullets above all)
      batch.species === "broiler" || uniformityPercent(s) === null ? null : t("Weighing.uniformity", { percent: formatPercent(uniformityPercent(s)!) }),
      standard
        ? t("Weighing.versusStandard", { gap: formatPercent(versusStandard(stats.averageGrams, standard.bodyWeightGrams), true), standard: formatKg(standard.bodyWeightGrams) })
        : t("Weighing.noStandard"),
    ].filter(Boolean).join(" · ");
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const sampleField = !group ? "weights" : parseQuantity(total, "kg") === null ? "total" : "count";
    if (!sample) return setError("errors.INVALID_SAMPLE", e.currentTarget, sampleField);
    const aggregate = Batch.rehydrate({ ...batch, placedOn: batch.placedOn as FarmDay, chickUnitPriceCentimes: 0n }, batch.status);
    const checked = aggregate.checkWeighing(day as FarmDay, sample, today());
    if (!checked.ok) return setError(`errors.${checked.error}`, e.currentTarget, checked.error === "INVALID_SAMPLE" ? sampleField : checked.error.startsWith("DAY_") ? "day" : undefined);
    setError(undefined);
    const id = uuidv7();
    const dto: WeighingDto =
      "weightsGrams" in sample
        ? { id, batchId: batch.id, day, count: sample.weightsGrams.length, totalGrams: sample.weightsGrams.reduce((a, g) => a + g, 0), weightsGrams: sample.weightsGrams }
        : { id, batchId: batch.id, day, count: sample.count, totalGrams: sample.totalGrams, weightsGrams: [] };
    if (await write({ type: M.recordWeighing, payload: { id, batchId: batch.id, day, sample } }, [{ entity: "weighing", id, data: dto }])) {
      setWeights("");
      setTotal("");
      setCount("");
    }
  };

  const past = [...weighings].sort((x, y) => y.day.localeCompare(x.day) || y.id.localeCompare(x.id));
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="text-[17px] font-semibold text-ink-2">{t("Weighing.title")}</h3>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.day}>{t("Weighing.day")}</label>
          <input id={ids.day} name="day" {...bad("day")} type="date" value={day} max={today()} min={batch.placedOn} onChange={(e) => setDay(e.target.value)} className={field} />
        </div>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">{t("Weighing.mode")}</legend>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="mode" checked={!group} onChange={() => setGroup(false)} />{t("Weighing.individual")}</label>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="mode" checked={group} onChange={() => setGroup(true)} />{t("Weighing.group")}</label>
        </fieldset>
        {group ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.total}>{t("Weighing.totalKg")}</label>
              <input id={ids.total} name="total" {...bad("total")} value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" dir="ltr" className={field} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.count}>{t("Weighing.count")}</label>
              <input id={ids.count} name="count" {...bad("count")} value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" pattern="\d*" dir="ltr" className={field} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.weights}>{t("Weighing.weights")}</label>
            <textarea id={ids.weights} name="weights" {...bad("weights")} value={weights} onChange={(e) => setWeights(e.target.value)} rows={3} inputMode="decimal" dir="ltr" className={field} />
          </div>
        )}
        <p aria-live="polite">{sample ? describe(sample, day) : ""}</p>
        {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
        <button type="submit" className={primary}>{t("Weighing.save")}</button>
      </form>
      {past.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t("Weighing.past")}>
          {past.map((w) => (
            <li key={w.id} className="rounded-lg border border-line p-3">
              <span className="font-semibold">{t("Batches.age", { age: String(ageOfBatch(batch, w.day as FarmDay)) })}</span> · {describe(asSample(w), w.day)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
