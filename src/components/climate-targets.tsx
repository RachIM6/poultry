"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import { Scoped } from "@/components/scoped";
import { card, done, field, primary, secondary } from "@/components/ui";
import { formatDay } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { checkBands, CLIMATE_MUTATIONS as C, setOn, type Band, type TargetSet } from "@/modules/climate/shared";
import { PRODUCTION_TYPES } from "@/modules/flock/shared";
import { localDb, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";

// SPEC-m4 CL1, §2 on the static /climate/targets shell (L-Sensors "Régler les seuils d'alarme"): the targets per batch
// age come from the owner's source, typed here. Nothing is built in; each save is a new dated version.

export const ClimateTargetsScreen = () => <Scoped>{(scope) => <Targets {...scope} />}</Scoped>;

/** "24,5" → 245 tenths; null when empty; undefined when not a number with at most one decimal. */
export function parseTenths(text: string): number | null | undefined {
  const s = text.trim().replace(",", ".");
  if (s === "") return null;
  return /^-?\d{1,2}(\.\d)?$/.test(s) ? Math.round(Number(s) * 10) : undefined;
}
const parseWhole = (text: string): number | null | undefined => (text.trim() === "" ? null : /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : undefined);
export const tenths = (n: number | null) => (n === null ? "—" : (n / 10).toLocaleString("fr", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

function Targets(scope: Scope) {
  const t = useTranslations();
  const locale = useLocale();
  const db = localDb(scope);
  const sets = useLiveQuery(() => db.records.where("entity").equals("climateTargets").toArray(), [scope.userId, scope.organizationId]);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string>();
  if (!sets) return null;
  const all = sets.map((r) => r.data as TargetSet);
  const today = farmDayOf(new Date());
  // the sets for every type first, then each production type that has its own (SPEC-m3)
  const groups = [null, ...PRODUCTION_TYPES.filter((p) => all.some((s) => s.productionType === p))].map((p) => ({ type: p, set: p ? setOn(all.filter((s) => s.productionType === p), today, p) : setOn(all, today) }));

  const save = async (set: TargetSet) => {
    try {
      await writeLocal(db, { type: C.saveTargets, payload: set }, { entity: "climateTargets", id: set.id, data: set });
      setMessage("Farms.saved");
      setAdding(false);
    } catch {
      setMessage("Farms.saveFailed");
    }
  };

  return (
    <>
      {message && <p role="status" className={done}>{t(message)}</p>}
      {groups.map(({ type, set: current }) => current ? (
        <section key={type ?? "all"} aria-label={type ? t(`Types.${type}`) : t("Climate.currentTargets")} className={card}>
          <h2 className="font-semibold">{type ? t(`Types.${type}`) : t("Climate.allTypes")}</h2>
          <p className="text-sm text-ink-2">{t("Climate.inForce", { date: formatDay(current.validFrom as FarmDay, locale), source: current.source })}</p>
          <ul className="flex flex-col gap-1" aria-label={t("Climate.bands")}>
            {current.bands.map((b) => (
              <li key={b.fromAge}>
                {t("Climate.bandLine", {
                  from: String(b.fromAge),
                  to: String(b.toAge),
                  tmin: tenths(b.temperatureMinTenths),
                  tmax: tenths(b.temperatureMaxTenths),
                  hmin: b.humidityMin ?? "—",
                  hmax: b.humidityMax ?? "—",
                  nh3: b.ammoniaMax ?? "—",
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : type === null ? (
        <p key="all" role="note" className="rounded-2xl bg-chick-soft p-3">{t("Climate.noTargets")}</p>
      ) : null)}
      {can(scope, "climate.manage") &&
        (adding ? <TargetsForm onSave={save} onCancel={() => setAdding(false)} /> : <button type="button" onClick={() => setAdding(true)} className={primary}>{t("Climate.enterTargets")}</button>)}
    </>
  );
}

const BAND_FIELDS = ["fromAge", "toAge", "temperatureMin", "temperatureMax", "humidityMin", "humidityMax", "ammoniaMax"] as const;

function TargetsForm({ onSave, onCancel }: { onSave: (s: TargetSet) => Promise<void>; onCancel: () => void }) {
  const t = useTranslations();
  const [rows, setRows] = useState([0]);
  const [error, setError] = useState<string>();

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "");
    const bands: Band[] = [];
    for (const r of rows) {
      const v = Object.fromEntries(BAND_FIELDS.map((f) => [f, get(`${f}-${r}`)]));
      const b = {
        fromAge: parseWhole(v.fromAge),
        toAge: parseWhole(v.toAge),
        temperatureMinTenths: parseTenths(v.temperatureMin),
        temperatureMaxTenths: parseTenths(v.temperatureMax),
        humidityMin: parseWhole(v.humidityMin),
        humidityMax: parseWhole(v.humidityMax),
        ammoniaMax: parseWhole(v.ammoniaMax),
      };
      if (Object.values(b).includes(undefined) || b.fromAge === null || b.toAge === null) return setError("errors.INVALID_BAND");
      bands.push(b as Band);
    }
    const checked = checkBands(bands);
    if (!checked.ok) return setError(`errors.${checked.error}`);
    setError(undefined);
    await onSave({ id: uuidv7(), validFrom: get("validFrom"), source: get("source").trim(), bands, productionType: get("productionType") || null });
  };

  return (
    <form onSubmit={submit} className={card} aria-label={t("Climate.enterTargets")}>
      <p className="text-sm text-ink-2">{t("Climate.targetsHint")}</p>
      <label className="flex flex-col gap-1">
        {t("Climate.productionType")}
        <select name="productionType" className={field}>
          <option value="">{t("Climate.allTypes")}</option>
          {PRODUCTION_TYPES.map((p) => <option key={p} value={p}>{t(`Types.${p}`)}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">{t("Pay.source")}<input name="source" required minLength={3} maxLength={300} className={field} /></label>
      <label className="flex flex-col gap-1">{t("Pay.validFrom")}<input name="validFrom" type="date" required defaultValue={farmDayOf(new Date())} className={field} /></label>
      {rows.map((r, i) => (
        <fieldset key={r} className="grid grid-cols-2 gap-2 rounded-2xl border border-line p-3">
          <legend className="px-1 font-medium">{t("Climate.band", { n: String(i + 1) })}</legend>
          {BAND_FIELDS.map((f) => (
            <label key={f} className="flex flex-col gap-1 text-sm">
              {t(`Climate.fields.${f}`)}
              <input name={`${f}-${r}`} inputMode="decimal" dir="ltr" required={f === "fromAge" || f === "toAge"} className={field} />
            </label>
          ))}
        </fieldset>
      ))}
      <button type="button" onClick={() => setRows((x) => [...x, Math.max(...x) + 1])} className={secondary}>{t("Climate.addBand")}</button>
      {error && <p role="alert">{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Climate.saveTargets")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("Receivables.cancel")}</button>
      </div>
    </form>
  );
}
