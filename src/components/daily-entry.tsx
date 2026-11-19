"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import {
  Batch,
  DEATH_CAUSES,
  EMPTY_DAY,
  FLOCK_MUTATIONS as M,
  changedFields,
  dailyEntryId,
  type BatchDto,
  type DailyEntryDto,
  type DayFields,
  type DeathCause,
} from "@/modules/flock/schema";
import { parseQuantity, type StockItemDto } from "@/modules/inventory/schema";

// SPEC B2 on the phone: one short screen, built to be filled in under a minute. Same checks as the server; only the
// fields that changed are sent, so two phones entering the same day merge instead of overwriting each other.

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const primary = "rounded-lg bg-green-700 px-4 py-3 text-lg font-semibold text-white";
const today = () => farmDayOf(new Date());

export type Write = (mutation: { type: string; payload: unknown }, records: { entity: string; id: string; data: unknown }[]) => Promise<boolean>;

export function DayForm({ batch, entries, soldBirds, feedItems, write }: { batch: BatchDto; entries: DailyEntryDto[]; soldBirds: number; feedItems: StockItemDto[]; write: Write }) {
  const t = useTranslations("Day");
  const [day, setDay] = useState<string>(today());
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={id}>{t("day")}</label>
        <input id={id} type="date" value={day} max={today()} min={batch.placedOn} onChange={(e) => setDay(e.target.value)} className={field} />
      </div>
      {/* keyed by day: switching days reloads that day's saved values */}
      <EntryFields key={day} batch={batch} day={day} entries={entries} soldBirds={soldBirds} feedItems={feedItems} write={write} />
    </div>
  );
}

function EntryFields({
  batch,
  day,
  entries,
  soldBirds,
  feedItems,
  write,
}: {
  batch: BatchDto;
  day: string;
  entries: DailyEntryDto[];
  soldBirds: number;
  feedItems: StockItemDto[];
  write: Write;
}) {
  const t = useTranslations();
  const entryId = dailyEntryId(batch.id, day);
  const saved = entries.find((e) => e.id === entryId) ?? null;
  const current: DayFields = saved ?? EMPTY_DAY;
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const count = (k: string) => (get(k) === "" ? 0 : /^\d+$/.test(get(k)) ? Number(get(k)) : NaN);
    const feedItem = feedItems.find((i) => i.id === get("feedItem"));
    const grams = feedItem && get("feedKg") ? parseQuantity(get("feedKg"), "kg") : null;
    const water = get("water") ? parseQuantity(get("water"), "kg") : null; // litres, to the millilitre: same 3 decimals as kg
    if ((feedItem && get("feedKg") && grams === null) || (get("water") && water === null)) return setError("Stock.invalid");

    const next: DayFields = {
      dead: count("dead"),
      deathCause: count("dead") > 0 ? ((get("cause") || "unknown") as DeathCause) : null,
      culled: count("culled"),
      feed: feedItem && grams ? { stockItemId: feedItem.id, grams } : null,
      waterMl: water,
      note: get("note") || null,
    };
    const aggregate = Batch.rehydrate({ ...batch, placedOn: batch.placedOn as FarmDay, chickUnitPriceCentimes: 0n }, batch.status);
    const outElsewhere = entries.filter((x) => x.id !== entryId).reduce((n, x) => n + x.dead + x.culled, soldBirds); // B5: sold count too
    const checked = aggregate.checkDay(day as FarmDay, next, outElsewhere, today());
    if (!checked.ok) return setError(checked.error === "INVALID_QUANTITY" ? "Stock.invalid" : `errors.${checked.error}`);
    const changes = changedFields(saved, next);
    if (Object.keys(changes).length === 0) return setError("Day.nothing");
    setError(undefined);

    const entry: DailyEntryDto = { id: entryId, batchId: batch.id, day, ...next };
    const movement = next.feed
      ? { id: entryId, farmId: batch.farmId, stockItemId: next.feed.stockItemId, kind: "consumption", quantity: -next.feed.grams, day, reason: null, purchaseId: null }
      : null; // S4: the phone's stock shows the consumption at once
    const records: { entity: string; id: string; data: unknown }[] = [{ entity: "dailyEntry", id: entryId, data: entry }];
    if ("feed" in changes) records.push({ entity: "movement", id: entryId, data: movement });
    await write({ type: M.recordDay, payload: { batchId: batch.id, day, changes } }, records);
  };

  const kg = (g: number) => String(g / 1000).replace(".", ",");
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field name="dead" label={t("Day.dead")} defaultValue={current.dead || ""} inputMode="numeric" pattern="\d*" dir="ltr" />
        <Field name="culled" label={t("Day.culled")} defaultValue={current.culled || ""} inputMode="numeric" pattern="\d*" dir="ltr" />
      </div>
      <Select name="cause" label={t("Day.cause")} defaultValue={current.deathCause ?? "unknown"}>
        {DEATH_CAUSES.map((c) => <option key={c} value={c}>{t(`Day.causes.${c}`)}</option>)}
      </Select>
      <Select name="feedItem" label={t("Day.feed")} defaultValue={current.feed?.stockItemId ?? feedItems[0]?.id ?? ""}>
        <option value="">{t("Day.noFeed")}</option>
        {feedItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </Select>
      <Field name="feedKg" label={t("Day.feedKg")} defaultValue={current.feed ? kg(current.feed.grams) : ""} inputMode="decimal" dir="ltr" />
      <Field name="water" label={t("Day.water")} defaultValue={current.waterMl ? kg(current.waterMl) : ""} inputMode="decimal" dir="ltr" />
      <Field name="note" label={t("Day.note")} defaultValue={current.note ?? ""} maxLength={500} />
      {error && <p role="alert">{t(error)}</p>}
      <button type="submit" className={primary}>{t("Day.save")}</button>
    </form>
  );
}

function Field({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      <input id={id} className={field} {...input} />
    </div>
  );
}

function Select({ label, name, defaultValue, children }: { label: string; name: string; defaultValue?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} defaultValue={defaultValue} className={field}>{children}</select>
    </div>
  );
}
