"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import { useInline } from "@/components/focus";
import { dataTable, dataTableWrap, formActions, num, sectionHead, sectionTitle } from "@/components/layout";
import { Scoped } from "@/components/scoped";
import { Sheet } from "@/components/sheet";
import { danger, done, field, ghost, primary, primarySm, secondarySm } from "@/components/ui";
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
  const { open, opener, close } = useInline<"targets">();
  const [message, setMessage] = useState<string>();
  const headId = useId();
  if (!sets) return null;
  const all = sets.map((r) => r.data as TargetSet);
  const today = farmDayOf(new Date());
  // the sets for every type first, then each production type that has its own (SPEC-m3)
  const groups = [null, ...PRODUCTION_TYPES.filter((p) => all.some((s) => s.productionType === p))].map((p) => ({ type: p, set: p ? setOn(all.filter((s) => s.productionType === p), today, p) : setOn(all, today) }));

  const save = async (set: TargetSet) => {
    try {
      await writeLocal(db, { type: C.saveTargets, payload: set }, { entity: "climateTargets", id: set.id, data: set });
      setMessage("Farms.saved");
      close();
    } catch {
      setMessage("Farms.saveFailed");
    }
  };

  // tasks/plan-ui-cleanup.md §4: each set as a table of its age bands; a new version is typed in a sheet.
  const range = (min: string | number, max: string | number) => <bdi dir="ltr">{min} – {max}</bdi>;
  return (
    <section aria-labelledby={headId} className="flex flex-col gap-4">
      <div className={sectionHead}>
        <h2 id={headId} className={sectionTitle}>{t("Climate.currentTargets")}</h2>
        {can(scope, "climate.manage") && <button type="button" aria-haspopup="dialog" {...opener("targets")} className={primarySm}>{t("Climate.enterTargets")}</button>}
      </div>
      {message && <p role="status" className={done}>{t(message)}</p>}
      {groups.map(({ type, set: current }) => current ? (
        <section key={type ?? "all"} aria-label={type ? t(`Types.${type}`) : t("Climate.currentTargets")} className="flex flex-col gap-2">
          <h3 className="font-semibold">{type ? t(`Types.${type}`) : t("Climate.allTypes")}</h3>
          <p className="text-sm text-ink-2">{t("Climate.inForce", { date: formatDay(current.validFrom as FarmDay, locale), source: current.source })}</p>
          <div className={dataTableWrap}>
            <table className={dataTable} aria-label={t("Climate.bands")}>
              <thead>
                <tr>
                  <th scope="col">{t("Climate.colAge")}</th>
                  <th scope="col" className={num}>{t("Climate.temperature")}</th>
                  <th scope="col" className={num}>{t("Climate.humidity")}</th>
                  <th scope="col" className={num}>{t("Climate.colAmmonia")}</th>
                </tr>
              </thead>
              <tbody>
                {current.bands.map((b) => (
                  <tr key={b.fromAge}>
                    <td>{range(`J${b.fromAge}`, `J${b.toAge}`)}</td>
                    <td className={num}>{range(tenths(b.temperatureMinTenths), tenths(b.temperatureMaxTenths))}</td>
                    <td className={num}>{range(b.humidityMin ?? "—", b.humidityMax ?? "—")}</td>
                    <td className={num}>{b.ammoniaMax ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : type === null ? (
        <p key="all" role="note" className="rounded-2xl bg-chick-soft p-3">{t("Climate.noTargets")}</p>
      ) : null)}
      <Sheet open={open === "targets"} onClose={close} title={t("Climate.enterTargets")}>
        <TargetsForm onSave={save} onCancel={close} />
      </Sheet>
    </section>
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
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label={t("Climate.enterTargets")}>
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
      <button type="button" onClick={() => setRows((x) => [...x, Math.max(...x) + 1])} className={secondarySm}>{t("Climate.addBand")}</button>
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <div className={formActions}>
        <button type="submit" className={primary}>{t("Climate.saveTargets")}</button>
        <button type="button" onClick={onCancel} className={ghost}>{t("Receivables.cancel")}</button>
      </div>
    </form>
  );
}
