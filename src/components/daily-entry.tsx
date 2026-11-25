"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import {
  Batch,
  DEATH_CAUSES,
  EMPTY_DAY,
  FLOCK_MUTATIONS as M,
  birdsOnHand,
  birdsStarted,
  changedFields,
  dailyEntryId,
  type BatchDto,
  type DailyEntryDto,
  type DayFields,
  type DeathCause,
  type SoldBirdsDto,
} from "@/modules/flock/shared";
import { parseQuantity, type StockItemDto } from "@/modules/inventory/shared";
import { card, danger, field, primary } from "@/components/ui";

// SPEC B2 on the phone: one short screen, built to be filled in under a minute. Same checks as the server; only the
// fields that changed are sent, so two phones entering the same day merge instead of overwriting each other.

const today = () => farmDayOf(new Date());

/** The feed of the batch's latest earlier day: a new day starts on it (starter, then grower, then finisher), not on the first item. */
export const lastFeed = (entries: DailyEntryDto[], day: string) =>
  entries.reduce<DailyEntryDto | undefined>((last, e) => (e.feed && e.day < day && (!last || e.day > last.day) ? e : last), undefined)?.feed?.stockItemId;

export type Write = (mutation: { type: string; payload: unknown }, records: { entity: string; id: string; data: unknown }[]) => Promise<boolean>;

export function DayForm({ batch, entries, sold, feedItems, write }: { batch: BatchDto; entries: DailyEntryDto[]; sold: SoldBirdsDto[]; feedItems: StockItemDto[]; write: Write }) {
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
      <EntryFields key={day} batch={batch} day={day} entries={entries} sold={sold} feedItems={feedItems} write={write} />
    </div>
  );
}

function EntryFields({
  batch,
  day,
  entries,
  sold,
  feedItems,
  write,
}: {
  batch: BatchDto;
  day: string;
  entries: DailyEntryDto[];
  sold: SoldBirdsDto[];
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
    const onHand = birdsOnHand(birdsStarted(batch), entries.filter((x) => x.id !== entryId), sold); // the other days; B5: sold count too
    const checked = aggregate.checkDay(day as FarmDay, next, onHand, today());
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
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <section className={card}>
        <Stepper name="dead" label={t("Day.dead")} defaultValue={current.dead ? String(current.dead) : ""} step={1} big />
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">{t("Day.cause")}</legend>
          {DEATH_CAUSES.map((c) => (
            <label key={c} className="relative inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-card px-3.5 text-[15px] has-checked:border-ink has-checked:bg-ink has-checked:font-semibold has-checked:text-shell">
              <input type="radio" name="cause" value={c} defaultChecked={(current.deathCause ?? "unknown") === c} className="absolute inset-0 cursor-pointer appearance-none rounded-full" />
              {t(`Day.causes.${c}`)}
            </label>
          ))}
        </fieldset>
        <div className="border-t border-line pt-2.5">
          <Stepper name="culled" label={t("Day.culled")} defaultValue={current.culled ? String(current.culled) : ""} step={1} />
        </div>
      </section>
      <section className={card}>
        <Select name="feedItem" label={t("Day.feed")} defaultValue={current.feed?.stockItemId ?? feedItems.find((i) => i.id === lastFeed(entries, day))?.id ?? feedItems[0]?.id ?? ""}>
          <option value="">{t("Day.noFeed")}</option>
          {feedItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
        <Stepper name="feedKg" label={t("Day.feedKg")} defaultValue={current.feed ? kg(current.feed.grams) : ""} step={25} decimal big />
        <p className="text-[13px] text-muted">{t("Day.feedHint")}</p>
      </section>
      <section className={card}>
        <Stepper name="water" label={t("Day.water")} defaultValue={current.waterMl ? kg(current.waterMl) : ""} step={100} decimal />
      </section>
      <Field name="note" label={t("Day.note")} defaultValue={current.note ?? ""} maxLength={500} />
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <button type="submit" className={primary}>{t("Day.save")}</button>
      <p className="text-center text-[13px] text-muted">{t("Day.offline")}</p>
    </form>
  );
}

// M1-DailyEntry.dc.html: big − / + around a value that can still be typed (1 425 kg is quicker to type than to tap).
function Stepper({ name, label, defaultValue, step, decimal = false, big = false }: { name: string; label: string; defaultValue: string; step: number; decimal?: boolean; big?: boolean }) {
  const t = useTranslations("Day");
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const bump = (by: number) => {
    const n = Math.max(0, Math.round(((Number(value.replace(",", ".")) || 0) + by) * 1000) / 1000); // display only: parsed exactly on save
    setValue(n === 0 ? "" : String(n).replace(".", ","));
  };
  const button = `grid ${big ? "size-[52px] text-2xl" : "size-11 text-lg"} shrink-0 place-items-center rounded-2xl font-semibold active:scale-95`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label htmlFor={id} className={`flex-1 ${big ? "text-lg font-semibold" : "text-base text-ink-2"}`}>{label}</label>
      <div className="inline-flex items-center rounded-2xl border border-muted bg-shell">
        <button type="button" aria-label={t("minus", { step: String(step), label })} onClick={() => bump(-step)} className={button}>−</button>
        <input
          id={id}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode={decimal ? "decimal" : "numeric"}
          pattern={decimal ? undefined : "\\d*"}
          dir="ltr"
          placeholder="0"
          className={`${big ? "w-24 text-[28px]" : "w-20 text-xl"} min-w-0 self-stretch bg-transparent text-center font-semibold placeholder:text-muted`}
        />
        <button type="button" aria-label={t("plus", { step: String(step), label })} onClick={() => bump(step)} className={button}>+</button>
      </div>
    </div>
  );
}

function Field({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-ink-2">{label}</label>
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
