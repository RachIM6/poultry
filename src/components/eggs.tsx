"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import type { Write } from "@/components/daily-entry";
import { card, field, primary, secondary } from "@/components/ui";
import { formatCount, formatPercent } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { EGG_CATEGORIES, EGG_MUTATIONS as M, EMPTY_COUNTS, checkCollection, downgradedIn, eggsIn, type EggCategory, type EggCollectionDto, type EggCounts } from "@/modules/eggs/shared";
import type { BatchDto } from "@/modules/flock/shared";

// SPEC-m3 E1 on a layer batch's screen (P-EggCollect): several collections a day, counted with steppers, offline.

const today = () => farmDayOf(new Date());
const STEP: Record<EggCategory, number> = { normal: 30, cracked: 1, dirty: 1, doubleYolk: 1, floor: 1, broken: 1 }; // a tray of normal eggs at a time

export function EggCollections({ batch, collections, write }: { batch: BatchDto; collections: EggCollectionDto[]; write: Write }) {
  const t = useTranslations();
  const [day, setDay] = useState<string>(today());
  const [counts, setCounts] = useState<EggCounts>(EMPTY_COUNTS);
  const [sample, setSample] = useState({ count: "", grams: "" });
  const [editing, setEditing] = useState<EggCollectionDto | null>(null);
  const [error, setError] = useState<string>();
  const ids = { day: useId(), sampleCount: useId(), sampleGrams: useId() };
  const ofDay = collections.filter((c) => c.day === day).sort((a, b) => a.id.localeCompare(b.id)); // UUIDv7: in order
  const total = eggsIn(counts);
  const set = (k: EggCategory, n: number) => setCounts((c) => ({ ...c, [k]: Math.max(0, Number.isFinite(n) ? Math.floor(n) : 0) }));

  const reset = () => {
    setCounts(EMPTY_COUNTS);
    setSample({ count: "", grams: "" });
    setEditing(null);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const s = sample.count || sample.grams ? { count: Number(sample.count), grams: Number(sample.grams) } : null;
    const on = (editing?.day ?? day) as FarmDay;
    const checked = checkCollection({ ...batch, placedOn: batch.placedOn as FarmDay }, on, counts, s, today()); // as the server
    if (!checked.ok) return setError(`errors.${checked.error}`);
    setError(undefined);
    const dto: EggCollectionDto = { id: editing?.id ?? uuidv7(), batchId: batch.id, day: on, counts, sample: s };
    const mutation = editing
      ? { type: M.correctCollection, payload: { id: dto.id, counts, sample: s } }
      : { type: M.recordCollection, payload: dto };
    if (await write(mutation, [{ entity: "eggCollection", id: dto.id, data: dto }])) reset();
  };

  const number = editing ? ofDay.findIndex((c) => c.id === editing.id) + 1 : ofDay.length + 1;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="eggs-title">
      <h3 id="eggs-title" className="text-lg font-semibold">{t("Eggs.title")}</h3>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.day}>{t("Eggs.day")}</label>
        <input id={ids.day} type="date" value={day} max={today()} onChange={(e) => (setDay(e.target.value), reset())} className={field} />
      </div>
      {ofDay.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t("Eggs.ofDay")}>
          {ofDay.map((c, i) => (
            <li key={c.id} className="flex items-center justify-between gap-3">
              <span>{t("Eggs.line", { n: String(i + 1), eggs: formatCount(eggsIn(c.counts)), down: formatCount(downgradedIn(c.counts)) })}</span>
              {batch.status === "open" && (
                <button type="button" className={secondary} onClick={() => (setEditing(c), setCounts(c.counts), setSample({ count: String(c.sample?.count ?? ""), grams: String(c.sample?.grams ?? "") }))}>
                  {t("Eggs.correct")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {batch.status === "open" && (
        <form onSubmit={submit} className={card}>
          <h4 className="font-semibold">{t("Eggs.collection", { n: String(number) })}</h4>
          {EGG_CATEGORIES.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="flex flex-1 flex-col">
                <b className="font-semibold">{t(`Eggs.categories.${k}`)}</b>
                <span className="text-sm text-muted">{t(`Eggs.hints.${k}`)}</span>
              </span>
              <button type="button" className={`${secondary} size-11 text-xl`} aria-label={t("Eggs.remove", { step: String(STEP[k]), label: t(`Eggs.categories.${k}`) })} onClick={() => set(k, counts[k] - STEP[k])}>−</button>
              <input
                aria-label={t(`Eggs.categories.${k}`)}
                value={String(counts[k])}
                onChange={(e) => set(k, Number(e.target.value))}
                inputMode="numeric"
                dir="ltr"
                className={`${field} w-24 text-center`}
              />
              <button type="button" className={`${secondary} size-11 text-xl`} aria-label={t("Eggs.add", { step: String(STEP[k]), label: t(`Eggs.categories.${k}`) })} onClick={() => set(k, counts[k] + STEP[k])}>+</button>
            </div>
          ))}
          <fieldset className="flex gap-2">
            <legend className="mb-1">{t("Eggs.sample")}</legend>
            <label className="flex flex-1 flex-col gap-1">
              {t("Eggs.sampleCount")}
              <input id={ids.sampleCount} value={sample.count} onChange={(e) => setSample((s) => ({ ...s, count: e.target.value }))} inputMode="numeric" dir="ltr" className={field} />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              {t("Eggs.sampleGrams")}
              <input id={ids.sampleGrams} value={sample.grams} onChange={(e) => setSample((s) => ({ ...s, grams: e.target.value }))} inputMode="numeric" dir="ltr" className={field} />
            </label>
          </fieldset>
          <p className="rounded-2xl bg-ink p-3 text-shell" aria-live="polite">
            {t("Eggs.total", { eggs: formatCount(total) })}
            {total > 0 && ` · ${t("Eggs.downgraded", { percent: formatPercent((downgradedIn(counts) / total) * 100) })}`}
          </p>
          {error && <p role="alert">{t(error)}</p>}
          <div className="flex gap-3">
            <button type="submit" className={primary}>{editing ? t("Eggs.saveCorrection") : t("Eggs.save")}</button>
            {editing && <button type="button" className={secondary} onClick={reset}>{t("Closing.cancel")}</button>}
          </div>
        </form>
      )}
    </section>
  );
}
