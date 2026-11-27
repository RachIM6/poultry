"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import { parseTenths, tenths } from "@/components/climate-targets";
import { useInline } from "@/components/focus";
import { formActions, rowHead, sectionTitle, split } from "@/components/layout";
import { Pager } from "@/components/pager";
import { pageOf, TABLE_PAGE } from "@/components/paging";
import { Scoped } from "@/components/scoped";
import { Sheet } from "@/components/sheet";
import { card, danger, done, field, primary, secondarySm } from "@/components/ui";
import { formatDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { farmDayOf, farmMinutesOf, type FarmDay } from "@/lib/kernel/farm-day";
import { CLIMATE_MUTATIONS as C, outOfRange, targetFor, verdicts, type Band, type PowerCutDto, type ReadingDto, type TargetSet, type Verdict } from "@/modules/climate/shared";
import type { HouseDto } from "@/modules/farm-registry/schema";
import { ageOfBatch, type BatchDto } from "@/modules/flock/shared";
import { localDb, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";

// SPEC-m4 CL2, CL3 on the static /climate shell (K-Climate), offline: a house's reading, judged on the phone against the
// owner's targets for the age of the house's batch (the same rule as the server's alert).

export const ClimateScreen = () => <Scoped>{(scope) => <Climate {...scope} />}</Scoped>;

const now = () => {
  const m = farmMinutesOf(new Date());
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const whole = (s: string) => (/^\d{1,3}$/.test(s.trim()) ? Number(s.trim()) : null);
const TONE: Record<Verdict, string> = { below: "text-brick-fg", above: "text-brick-fg", within: "text-olive", none: "text-muted" };

function Climate(scope: Scope) {
  const t = useTranslations();
  const db = localDb(scope);
  const records = useLiveQuery(() => db.records.where("entity").anyOf("house", "batch", "climateTargets", "climateReading", "powerCut").toArray(), [scope.userId, scope.organizationId]);
  const [houseId, setHouseId] = useState<string>();
  const [values, setValues] = useState({ temperature: "", humidity: "", ammonia: "" });
  const [saved, setSaved] = useState<ReadingDto | null>(null);
  const [message, setMessage] = useState<string>();
  if (!records) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const houses = of<HouseDto>("house").sort((a, b) => a.name.localeCompare(b.name));
  if (houses.length === 0) return <p>{t("Farms.none")}</p>;
  const house = houses.find((h) => h.id === houseId) ?? houses[0];
  const today = farmDayOf(new Date());
  const batch = of<BatchDto>("batch").find((b) => b.houseId === house.id && b.status === "open" && b.placedOn <= today);
  const age = batch ? ageOfBatch(batch, today) : null; // the birds' age: hens placed at 18 weeks included (SPEC-m3 B7)
  const sets = of<TargetSet>("climateTargets");
  const band = age === null ? null : targetFor(sets, today, age, batch?.species);
  const reading = { temperatureTenths: parseTenths(values.temperature) ?? null, humidity: whole(values.humidity), ammonia: whole(values.ammonia) };
  const live = verdicts({ temperatureTenths: reading.temperatureTenths ?? 0, humidity: reading.humidity ?? 0, ammonia: reading.ammonia }, band);

  const hint = (key: "temperature" | "humidity" | "ammonia", entered: boolean) => {
    const range = (b: Band) =>
      key === "temperature" ? `${tenths(b.temperatureMinTenths)} – ${tenths(b.temperatureMaxTenths)} °C` : key === "humidity" ? `${b.humidityMin ?? "—"} – ${b.humidityMax ?? "—"} %` : `≤ ${b.ammoniaMax ?? "—"} ppm`;
    if (!band || age === null) return <span className="text-xs text-muted">{t("Climate.noTarget")}</span>;
    const v = entered ? live[key] : "none";
    return <span className={`text-xs ${TONE[v]}`}>{t("Climate.target", { age: String(age), range: range(band) })}{v !== "none" ? ` · ${t(`Climate.verdicts.${v}`)}` : ""}</span>;
  };

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    if (reading.temperatureTenths === null || reading.humidity === null || (values.ammonia.trim() !== "" && reading.ammonia === null)) return setMessage("errors.INVALID_QUANTITY");
    const r: ReadingDto = { id: uuidv7(), farmId: house.farmId, houseId: house.id, day: String(data.get("day")), time: String(data.get("time")), temperatureTenths: reading.temperatureTenths, humidity: reading.humidity, ammonia: reading.ammonia, byUserId: scope.userId };
    try {
      await writeLocal(db, { type: C.recordReading, payload: r }, { entity: "climateReading", id: r.id, data: r });
      setSaved(r);
      setValues({ temperature: "", humidity: "", ammonia: "" });
      setMessage("Farms.saved");
    } catch {
      setMessage("Farms.saveFailed");
    }
  };
  const savedVerdicts = saved && band && verdicts(saved, band);
  const off = savedVerdicts ? (["temperature", "humidity", "ammonia"] as const).filter((k) => savedVerdicts[k] === "below" || savedVerdicts[k] === "above") : [];

  // Wide screens: the house and the power cut on one row, then the entry beside the history (tasks/plan-ui.md "Desktop
  // rules"); the phone: one column, in this order.
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select aria-label={t("Climate.house")} value={house.id} onChange={(e) => (setHouseId(e.target.value), setSaved(null))} className={`${field} w-full lg:max-w-xs`}>
          {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        {can(scope, "climate.record") && (
          <PowerCuts
            farmId={house.farmId}
            cuts={of<PowerCutDto>("powerCut")}
            save={(type, cut) => writeLocal(db, { type, payload: cut }, { entity: "powerCut", id: cut.id, data: cut }).then(() => setMessage("Farms.saved"), () => setMessage("Farms.saveFailed"))}
          />
        )}
      </div>
      <div className={split}>
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-2">{age === null ? t("Climate.noBatch") : t("Climate.age", { day: String(age) })}</p>
          {message && <p role="status" className={done}>{t(message)}</p>}
          {savedVerdicts && outOfRange(savedVerdicts) && (
            <p role="alert" className={danger}>{t("Climate.outOfRange", { values: off.map((k) => t(`Climate.offValue.${k}.${savedVerdicts[k]}`)).join(", ") })}</p>
          )}
          {can(scope, "climate.record") && (
            <form onSubmit={submit} className={`${card} grid grid-cols-2 gap-3`} aria-label={t("Climate.reading")}>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink-2">
                {t("Climate.temperature")}
                <input inputMode="decimal" dir="ltr" required value={values.temperature} onChange={(e) => setValues({ ...values, temperature: e.target.value })} className={`${field} text-end text-xl font-semibold`} />
                {hint("temperature", values.temperature.trim() !== "")}
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink-2">
                {t("Climate.humidity")}
                <input inputMode="numeric" dir="ltr" required value={values.humidity} onChange={(e) => setValues({ ...values, humidity: e.target.value })} className={`${field} text-end text-xl font-semibold`} />
                {hint("humidity", values.humidity.trim() !== "")}
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-sm font-medium text-ink-2">
                {t("Climate.ammonia")}
                <input inputMode="numeric" dir="ltr" value={values.ammonia} onChange={(e) => setValues({ ...values, ammonia: e.target.value })} className={`${field} text-end text-xl font-semibold`} />
                {hint("ammonia", values.ammonia.trim() !== "")}
              </label>
              <label className="flex flex-col gap-1 text-sm">{t("Climate.day")}<input name="day" type="date" required max={today} defaultValue={today} className={field} /></label>
              <label className="flex flex-col gap-1 text-sm">{t("Climate.time")}<input name="time" type="time" required defaultValue={now()} className={field} /></label>
              <button type="submit" className={`${primary} col-span-2`}>{t("Climate.save")}</button>
            </form>
          )}
        </div>
        <History house={house} readings={of<ReadingDto>("climateReading")} cuts={of<PowerCutDto>("powerCut")} batches={of<BatchDto>("batch")} sets={sets} />
      </div>
    </>
  );
}

const clockOf = (iso: string) => {
  const m = farmMinutesOf(new Date(iso));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/**
 * CL5 (K-Climate footer, "Courant et groupe électrogène"): start a cut now, in one tap; end it with the generator's
 * details, in a sheet (tasks/plan-ui-cleanup.md §2.7).
 */
function PowerCuts({ farmId, cuts, save }: { farmId: string; cuts: PowerCutDto[]; save: (type: string, cut: PowerCutDto) => Promise<void> }) {
  const t = useTranslations();
  const [error, setError] = useState<string>();
  const { open: ending, opener, close } = useInline<"end">();
  const open = cuts.find((c) => c.farmId === farmId && c.endedAt === null);

  const end = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!open) return;
    const data = new FormData(ev.currentTarget);
    const started = data.get("generator") === "on";
    const seconds = String(data.get("seconds") ?? "").trim();
    const litres = String(data.get("diesel") ?? "").trim().replace(",", ".");
    if ((seconds && !/^\d{1,4}$/.test(seconds)) || (litres && !/^\d{1,4}(\.\d{1,3})?$/.test(litres))) return setError("errors.INVALID_QUANTITY");
    setError(undefined);
    // Diesel in millilitres (SPEC §5): "18,5" L → 18 500 ml, from the digits, never through a float.
    const [whole, frac = ""] = litres.split(".");
    await save(C.endPowerCut, {
      ...open,
      endedAt: new Date().toISOString(),
      generatorStarted: started,
      generatorSeconds: started && seconds ? Number(seconds) : null,
      dieselMl: started && litres ? Number(whole) * 1000 + Number(frac.padEnd(3, "0")) : null,
    });
    close();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => save(C.startPowerCut, { id: uuidv7(), farmId, startedAt: new Date().toISOString(), endedAt: null, generatorStarted: null, generatorSeconds: null, dieselMl: null })}
        className={`${secondarySm} border-alert-fg! font-semibold text-alert-fg!`}
      >
        {t("Climate.cutStart")}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-alert-fg bg-card px-3 py-1.5">
      <p role="status" className="font-semibold text-alert-fg">{t("Climate.cutOpen", { time: clockOf(open.startedAt) })}</p>
      <button type="button" aria-haspopup="dialog" {...opener("end")} className={secondarySm}>{t("Climate.cutEnd")}</button>
      <Sheet open={ending === "end"} onClose={close} title={t("Climate.cutEnd")}>
        <form onSubmit={end} className="flex flex-col gap-3" aria-label={t("Climate.cutEnd")}>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="generator" className="size-5" />{t("Climate.generatorStarted")}</label>
          <label className="flex flex-col gap-1">{t("Climate.generatorSeconds")}<input name="seconds" inputMode="numeric" dir="ltr" className={field} /></label>
          <label className="flex flex-col gap-1">{t("Climate.diesel")}<input name="diesel" inputMode="decimal" dir="ltr" className={field} /></label>
          {error && <p role="alert" className={danger}>{t(error)}</p>}
          <div className={formActions}><button type="submit" className={primary}>{t("Climate.cutEnd")}</button></div>
        </form>
      </Sheet>
    </div>
  );
}

// CL6 as a table from lg (tasks/plan-ui.md "Desktop rules"), one card of rows on the phone as before. The header row is
// hidden there, so the first reading has no top border (nth-2). Each reading's cells sit in the list's columns (subgrid).
const CUTS = 5; // the farm's last cuts in view; the others fold under them
const readingsTable = `${card} lg:grid lg:grid-cols-[auto_auto_minmax(0,1fr)] lg:gap-0 lg:overflow-hidden lg:p-0`;
const readingRow =
  "flex justify-between gap-3 border-t border-line py-2 nth-2:border-t-0 lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-6 lg:px-4 lg:py-2.5";

/**
 * CL6: the house's readings with their verdicts, newest first and paged (tasks/plan-ui-cleanup.md §2.5), and the farm's
 * power cuts with their duration: the last ones, the others folded.
 */
function History({ house, readings, cuts, batches, sets }: { house: HouseDto; readings: ReadingDto[]; cuts: PowerCutDto[]; batches: BatchDto[]; sets: TargetSet[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const search = useSearchParams();
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const all = readings.filter((r) => r.houseId === house.id).sort((a, b) => b.day.localeCompare(a.day) || b.time.localeCompare(a.time));
  const page = pageOf(search.get("page") ?? undefined, all.length, TABLE_PAGE);
  const last = all.slice((page - 1) * TABLE_PAGE, page * TABLE_PAGE);
  const ended = cuts.filter((c) => c.farmId === house.farmId && c.endedAt !== null).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  // The batch that was in the house on the reading's day: its age then picks the band, as on the server.
  const ageOn = (d: string) => {
    const b = batches.find((x) => x.houseId === house.id && x.placedOn <= d && (x.status === "open" || (x.closedOn ?? "") >= d));
    return b ? { age: ageOfBatch(b, d as FarmDay), type: b.species } : null;
  };
  if (last.length === 0 && ended.length === 0) return null;
  const cutLine = (c: PowerCutDto) => {
    const minutes = Math.round((Date.parse(c.endedAt!) - Date.parse(c.startedAt)) / 60_000);
    return (
      <li key={c.id} className="flex justify-between gap-3 border-t border-line py-2 first:border-t-0">
        <span>{day(farmDayOf(new Date(c.startedAt)))} · {clockOf(c.startedAt)} → {clockOf(c.endedAt!)}</span>
        <span className="text-sm text-ink-2">
          {t("Climate.cutMinutes", { minutes: String(minutes) })}
          {c.generatorStarted ? ` · ${t("Climate.generatorLine", { seconds: c.generatorSeconds ?? "—", litres: c.dieselMl === null ? "—" : (c.dieselMl / 1000).toLocaleString(locale === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", maximumFractionDigits: 3 }) })}` : ""}
        </span>
      </li>
    );
  };
  return (
    <section aria-label={t("Climate.history")} className="flex flex-col gap-3">
      <h2 className={sectionTitle}>{t("Climate.history")}</h2>
      {last.length > 0 && (
        <ul aria-label={t("Climate.lastReadings")} className={readingsTable}>
          <li aria-hidden="true" className={rowHead}>
            <span>{t("Climate.colWhen")}</span>
            <span>{t("Climate.colValues")}</span>
            <span>{t("Climate.colVerdict")}</span>
          </li>
          {last.map((r) => {
            const on = ageOn(r.day);
            const v = verdicts(r, on === null ? null : targetFor(sets, r.day, on.age, on.type));
            const off = (["temperature", "humidity", "ammonia"] as const).filter((k) => v[k] === "below" || v[k] === "above");
            return (
              <li key={r.id} className={readingRow}>
                <span className="lg:contents">
                  <span>{day(r.day)} · {r.time}</span>
                  <span className="block text-sm text-ink-2">{tenths(r.temperatureTenths)} °C · {r.humidity} %{r.ammonia === null ? "" : ` · ${r.ammonia} ppm`}</span>
                </span>
                <span className={`text-sm ${off.length ? "text-brick-fg" : "text-ink-2"}`}>
                  {off.length ? off.map((k) => t(`Climate.offValue.${k}.${v[k]}`)).join(", ") : Object.values(v).every((x) => x === "none") ? t("Climate.noTarget") : t("Climate.verdicts.within")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Pager page={page} size={TABLE_PAGE} total={all.length} href={(n) => ({ pathname: "/climate", query: { page: n } })} />
      {ended.length > 0 && (
        <>
          <ul aria-label={t("Climate.lastCuts")} className={card}>{ended.slice(0, CUTS).map(cutLine)}</ul>
          {ended.length > CUTS && (
            <details>
              <summary className="disclosure text-sm font-medium text-ink-2">{t("Climate.olderCuts", { count: ended.length - CUTS })}</summary>
              <ul aria-label={t("Climate.olderCuts", { count: ended.length - CUTS })} className={card}>{ended.slice(CUTS).map(cutLine)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
