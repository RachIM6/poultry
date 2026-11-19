"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { card, done, field, primary, warn } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { formatDateTime } from "@/lib/format";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { BIOSECURITY_MUTATIONS as B, VISIT_PURPOSES, VISITOR_RECENT_FARM_HOURS, ZONES, visitZone, type VisitDto, type Zone } from "@/modules/biosecurity/shared";
import type { FarmDto } from "@/modules/farm-registry/schema";
import { currentScope, localDb, scopeKey, type LocalDb, type LocalRecord, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";

// SPEC-m2-compliance §4 on static shells, offline: the logs a farm keeps on the phone (visitors, BS1–BS3).

const check = "flex min-h-11 items-center gap-3";

type Screen = (props: Scope & { db: LocalDb; records: LocalRecord[]; save: Save }) => ReactNode;
type Save = (mutation: { type: string; payload: unknown }, entity: string, data: { id: string }) => Promise<boolean>;

/** Signed-in scope, sync, the local records of `entities`, and a save that queues a mutation: what every log needs. */
function Shell({ entities, screen: Inner }: { entities: string[]; screen: Screen }) {
  const t = useTranslations("Sync");
  const scope = useLiveQuery(() => currentScope().then((s) => s ?? null), [], undefined);
  if (scope === undefined) return null;
  if (scope === null) {
    return (
      <p>
        {t("signedOut")} <Link href="/login" className="underline underline-offset-4">{t("login")}</Link>
      </p>
    );
  }
  return <Records key={scopeKey(scope)} scope={scope} entities={entities} screen={Inner} />;
}

function Records({ scope, entities, screen: Inner }: { scope: Scope; entities: string[]; screen: Screen }) {
  const { userId, organizationId, role } = scope;
  const t = useTranslations();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf(entities).toArray(), [userId, organizationId]);
  const [message, setMessage] = useState<string>();
  if (!can(scope, "biosecurity.record")) return <p>{t("Biosecurity.forbidden")}</p>;
  if (!records) return null;
  const save: Save = async (mutation, entity, data) => {
    try {
      await writeLocal(db, mutation, [{ entity, id: data.id, data }]);
      setMessage("Farms.saved");
      return true;
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
      return false;
    }
  };
  return (
    <>
      {message && <p role="status" className={done}>{t(message)}</p>}
      <Inner {...scope} db={db} records={records} save={save} />
    </>
  );
}

const of = <T,>(records: LocalRecord[], entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

/** The farm the log is about: the only one, or a choice. */
function useFarm(records: LocalRecord[]) {
  const farms = of<FarmDto>(records, "farm").sort((x, y) => x.name.localeCompare(y.name));
  const [chosen, setChosen] = useState<string>();
  const farm = farms.find((f) => f.id === chosen) ?? farms[0];
  return { farms, farm, setFarm: setChosen };
}

function FarmPicker({ farms, farm, setFarm }: ReturnType<typeof useFarm>) {
  const t = useTranslations("Biosecurity");
  if (farms.length < 2) return null;
  return (
    <Field label={t("farm")}>
      {(id) => (
        <select id={id} value={farm?.id} onChange={(e) => setFarm(e.target.value)} className={field}>
          {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}
    </Field>
  );
}

export const VisitorsScreen = () => <Shell entities={["farm", "visit"]} screen={Visitors} />;

function Visitors({ records, save }: Parameters<Screen>[0]) {
  const t = useTranslations("Visitors");
  const locale = useLocale();
  const picker = useFarm(records);
  const { farm } = picker;
  if (!farm) return <p>{t("noFarm")}</p>;
  const today = farmDayOf(new Date());
  const visits = of<VisitDto>(records, "visit")
    .filter((v) => v.farmId === farm.id && farmDayOf(new Date(v.enteredAt)) === today)
    .sort((x, y) => y.enteredAt.localeCompare(x.enteredAt));
  return (
    <>
      <FarmPicker {...picker} />
      <VisitForm key={farm.id} farmId={farm.id} onSave={(v) => save({ type: B.recordVisit, payload: v }, "visit", v)} />
      <h2 className="text-lg font-semibold">{t("today")}</h2>
      {visits.length === 0 ? (
        <p>{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("today")}>
          {visits.map((v) => (
            <li key={v.id} className={card}>
              {t("line", { visitor: v.visitor, time: formatDateTime(v.enteredAt, locale), zone: t(`zones.${v.zone}`) })}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function VisitForm({ farmId, onSave }: { farmId: string; onSave: (v: VisitDto) => Promise<boolean> }) {
  const t = useTranslations();
  const [recentFarm, setRecentFarm] = useState(false);
  const [zone, setZone] = useState<Zone>("dirty");
  const [key, setKey] = useState(0); // a new key empties the form after a save
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const allowed = visitZone({ recentFarm, zone });
    if (!allowed.ok) return setError(`errors.${allowed.error}`);
    setError(undefined);
    const saved = await onSave({
      id: uuidv7(),
      farmId,
      enteredAt: new Date().toISOString(),
      visitor: get("visitor"),
      vehicle: get("vehicle") || null,
      purpose: get("purpose") as VisitDto["purpose"],
      recentFarm,
      wheelsDisinfected: data.has("wheels"),
      footbath: data.has("footbath"),
      farmClothing: data.has("clothing"),
      zone: allowed.value,
    });
    if (saved) {
      setKey((k) => k + 1);
      setRecentFarm(false);
      setZone("dirty");
    }
  };

  return (
    <form key={key} onSubmit={submit} className="flex flex-col gap-3">
      <Field label={t("Visitors.visitor")}>{(id) => <input id={id} name="visitor" required maxLength={120} className={field} />}</Field>
      <Field label={t("Visitors.vehicle")}>{(id) => <input id={id} name="vehicle" maxLength={20} dir="ltr" className={field} />}</Field>
      <Field label={t("Visitors.purpose")}>
        {(id) => (
          <select id={id} name="purpose" className={field}>
            {VISIT_PURPOSES.map((p) => <option key={p} value={p}>{t(`Visitors.purposes.${p}`)}</option>)}
          </select>
        )}
      </Field>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-semibold">{t("Visitors.recentTitle", { hours: VISITOR_RECENT_FARM_HOURS })}</legend>
        <label className={check}>
          <input type="checkbox" checked={recentFarm} onChange={(e) => (setRecentFarm(e.target.checked), e.target.checked && setZone("dirty"))} className="size-6" />
          {t("Visitors.recentFarm")}
        </label>
        {recentFarm && <p className={warn}>{t("Visitors.dirtyOnly")}</p>}
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-semibold">{t("Visitors.checks")}</legend>
        <label className={check}><input type="checkbox" name="wheels" className="size-6" />{t("Visitors.wheels")}</label>
        <label className={check}><input type="checkbox" name="footbath" className="size-6" />{t("Visitors.footbath")}</label>
        <label className={check}><input type="checkbox" name="clothing" className="size-6" />{t("Visitors.clothing")}</label>
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-semibold">{t("Visitors.zone")}</legend>
        {ZONES.map((z) => (
          <label key={z} className={check}>
            <input type="radio" name="zone" value={z} checked={zone === z} disabled={recentFarm && z === "clean"} onChange={() => setZone(z)} className="size-6" />
            {t(`Visitors.zones.${z}`)}
          </label>
        ))}
      </fieldset>
      {error && <p role="alert">{t(error)}</p>}
      <button type="submit" className={primary}>{t("Visitors.save")}</button>
    </form>
  );
}
