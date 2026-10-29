"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, useSyncExternalStore, type FormEvent, type InputHTMLAttributes } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDay } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { FARM_MUTATIONS as M, FarmFields, HOUSE_TYPES, HouseFields, type FarmDto, type HouseDto } from "@/modules/farm-registry/schema";
import { currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";

// SPEC F2–F4. Runs on the static /farms shell: everything comes from and goes to the phone's database (ADR-003).

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const primary = "rounded-lg bg-green-700 px-4 py-3 font-semibold text-white";
const secondary = "rounded-lg border border-current/30 px-4 py-3";
const card = "flex flex-col gap-1 rounded-lg border border-current/30 p-3";

type Save = (mutation: { type: string; payload: unknown }, record: { entity: string; id: string; data: unknown }) => Promise<boolean>;

/** On the dashboard: what this phone holds, and the way in. */
export function FarmsLink({ userId, organizationId }: { userId: string; organizationId: string }) {
  const t = useTranslations("Farms");
  const farms = useLiveQuery(() => localDb({ userId, organizationId }).records.where("entity").equals("farm").count(), [userId, organizationId]);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-current/30 p-6 text-center">
      {farms !== undefined && <p>{farms > 0 ? t("count", { count: formatCount(farms) }) : t("none")}</p>}
      <Link href="/farms" className="underline underline-offset-4">{t("title")}</Link>
    </div>
  );
}

export function FarmsScreen() {
  const t = useTranslations("Sync");
  const scope = useLiveQuery(() => currentScope().then((s) => s ?? null), [], undefined);
  if (scope === undefined) return null; // reading the phone's storage
  if (scope === null) {
    return (
      <p>
        {t("signedOut")} <Link href="/login" className="underline underline-offset-4">{t("login")}</Link>
      </p>
    );
  }
  return <Farms key={scopeKey(scope)} {...scope} />;
}

// The open farm lives in the URL hash (#<id>): the path stays the precached /farms shell, offline included.
const onHashChange = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const useHash = () => useSyncExternalStore(onHashChange, () => decodeURIComponent(window.location.hash.slice(1)), () => "");

function Farms(scope: Scope) {
  const { userId, organizationId, role } = scope;
  const t = useTranslations("Farms");
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house").toArray(), [userId, organizationId]);
  const openId = useHash();
  const [message, setMessage] = useState<"saved" | "saveFailed">();

  if (!records) return null;
  const farms = records.filter((r) => r.entity === "farm").map((r) => r.data as FarmDto).sort((x, y) => x.name.localeCompare(y.name));
  const houses = records.filter((r) => r.entity === "house").map((r) => r.data as HouseDto);
  const manage = can(scope, "farms.manage");
  const save: Save = async (mutation, record) => {
    try {
      await writeLocal(db, mutation, record);
      setMessage("saved");
      return true;
    } catch {
      setMessage("saveFailed"); // QuotaExceededError: never pretend it was saved (poultry-pwa §0.8)
      return false;
    }
  };

  const open = farms.find((f) => f.id === openId);
  return (
    <>
      {message && <p role="status" className="rounded-lg bg-green-700/10 p-3">{t(message)}</p>}
      {openId ? (
        open ? (
          <FarmDetail key={open.id} farm={open} houses={houses.filter((h) => h.farmId === open.id)} manage={manage} save={save} />
        ) : (
          <>
            <a href="#" className="underline underline-offset-4">{t("back")}</a>
            <p>{t("notFound")}</p>
          </>
        )
      ) : (
        <FarmList farms={farms} houses={houses} manage={manage} save={save} />
      )}
    </>
  );
}

function FarmList({ farms, houses, manage, save }: { farms: FarmDto[]; houses: HouseDto[]; manage: boolean; save: Save }) {
  const t = useTranslations("Farms");
  const [adding, setAdding] = useState(false);
  return (
    <>
      {farms.length === 0 ? (
        <p>{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {farms.map((f) => (
            <li key={f.id}>
              <a href={`#${f.id}`} className={card}>
                <span className="font-semibold">{f.name}</span>
                <span className="text-sm opacity-75">
                  {t("farmSummary", { commune: f.commune, province: f.province, count: formatCount(houses.filter((h) => h.farmId === f.id).length) })}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {manage &&
        (adding ? (
          <FarmForm
            onCancel={() => setAdding(false)}
            onSubmit={async (fields) => {
              const id = uuidv7();
              if (await save({ type: M.createFarm, payload: { id, ...fields } }, { entity: "farm", id, data: { id, ...fields } })) {
                setAdding(false);
                window.location.hash = id;
              }
            }}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={primary}>{t("add")}</button>
        ))}
    </>
  );
}

/** Only the fields that differ: concurrent edits of other fields on another phone survive (ADR-003 §5). */
const changed = <T extends object>(before: T, after: T) =>
  Object.fromEntries(Object.entries(after).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof T]))) as Partial<T>;

function FarmDetail({ farm, houses, manage, save }: { farm: FarmDto; houses: HouseDto[]; manage: boolean; save: Save }) {
  const t = useTranslations("Farms");
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const { id, ...current } = farm;

  return (
    <>
      <a href="#" className="underline underline-offset-4">{t("back")}</a>
      {editing ? (
        <FarmForm
          initial={current}
          onCancel={() => setEditing(false)}
          onSubmit={async (fields) => {
            const changes = changed(current, fields);
            if (Object.keys(changes).length === 0) return setEditing(false);
            if (await save({ type: M.updateFarm, payload: { id, changes } }, { entity: "farm", id, data: { ...farm, ...changes } })) setEditing(false);
          }}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{farm.name}</h2>
          <p>{[farm.commune, farm.province, farm.region].join(", ")}</p>
          {farm.gps && <p dir="ltr" className="text-sm opacity-75">{`${farm.gps.lat}, ${farm.gps.lng}`}</p>}
          {farm.onssa && (
            <p className="text-sm">{t("onssaUntil", { number: farm.onssa.number, date: formatDay(farm.onssa.expiresOn as FarmDay, locale) })}</p>
          )}
          {manage && <button type="button" onClick={() => setEditing(true)} className={`${secondary} mt-2 self-start`}>{t("edit")}</button>}
        </div>
      )}

      <h2 className="text-lg font-semibold">{t("houses")}</h2>
      {houses.length === 0 ? (
        <p>{t("noHouses")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {houses.map((h) => <HouseRow key={h.id} house={h} manage={manage} save={save} />)}
        </ul>
      )}
      {manage &&
        (adding ? (
          <HouseForm
            onCancel={() => setAdding(false)}
            onSubmit={async (fields) => {
              const houseId = uuidv7();
              const data = { id: houseId, farmId: id, ...fields };
              if (await save({ type: M.createHouse, payload: data }, { entity: "house", id: houseId, data })) setAdding(false);
            }}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={primary}>{t("addHouse")}</button>
        ))}
    </>
  );
}

function HouseRow({ house, manage, save }: { house: HouseDto; manage: boolean; save: Save }) {
  const t = useTranslations("Farms");
  const [editing, setEditing] = useState(false);
  const { id, farmId, ...current } = house;
  if (editing) {
    return (
      <li>
        <HouseForm
          initial={current}
          onCancel={() => setEditing(false)}
          onSubmit={async (fields) => {
            const changes = changed(current, fields);
            if (Object.keys(changes).length === 0) return setEditing(false);
            if (await save({ type: M.updateHouse, payload: { id, changes } }, { entity: "house", id, data: { id, farmId, ...current, ...changes } })) setEditing(false);
          }}
        />
      </li>
    );
  }
  return (
    <li className={card}>
      <span className="font-semibold">{house.name}</span>
      <span className="text-sm opacity-75">
        {t("houseSummary", { area: formatCount(house.areaM2), capacity: formatCount(house.capacity), type: t(`types.${house.type}`) })}
      </span>
      {manage && <button type="button" onClick={() => setEditing(true)} className={`${secondary} mt-1 self-start py-2`}>{t("edit")}</button>}
    </li>
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

const read = (form: HTMLFormElement) => {
  const data = new FormData(form);
  const text = (k: string) => String(data.get(k) ?? "").trim();
  const num = (k: string) => (text(k) ? Number(text(k).replace(",", ".")) : undefined); // "33,5" as typed in French
  return { text, num };
};

function FarmForm({ initial, onSubmit, onCancel }: { initial?: FarmFields; onSubmit: (f: FarmFields) => void; onCancel: () => void }) {
  const t = useTranslations("Farms");
  const [invalid, setInvalid] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const { text, num } = read(e.currentTarget);
    const [lat, lng, number, expiresOn] = [num("lat"), num("lng"), text("onssaNumber"), text("onssaExpiresOn")];
    const parsed = FarmFields.safeParse({
      name: text("name"),
      region: text("region"),
      province: text("province"),
      commune: text("commune"),
      gps: lat === undefined && lng === undefined ? null : { lat, lng },
      onssa: !number && !expiresOn ? null : { number, expiresOn },
    });
    setInvalid(!parsed.success);
    if (parsed.success) onSubmit(parsed.data);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field name="name" label={t("name")} defaultValue={initial?.name} required maxLength={120} />
      <Field name="region" label={t("region")} defaultValue={initial?.region} required maxLength={80} />
      <Field name="province" label={t("province")} defaultValue={initial?.province} required maxLength={80} />
      <Field name="commune" label={t("commune")} defaultValue={initial?.commune} required maxLength={80} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1">{t("gps")}</legend>
        <Field name="lat" label={t("lat")} defaultValue={initial?.gps?.lat} inputMode="decimal" dir="ltr" />
        <Field name="lng" label={t("lng")} defaultValue={initial?.gps?.lng} inputMode="decimal" dir="ltr" />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1">{t("onssa")}</legend>
        <Field name="onssaNumber" label={t("onssaNumber")} defaultValue={initial?.onssa?.number} maxLength={40} dir="ltr" />
        <Field name="onssaExpiresOn" label={t("onssaExpiresOn")} defaultValue={initial?.onssa?.expiresOn} type="date" />
      </fieldset>
      {invalid && <p role="alert">{t("invalid")}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("save")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("cancel")}</button>
      </div>
    </form>
  );
}

function HouseForm({ initial, onSubmit, onCancel }: { initial?: HouseFields; onSubmit: (f: HouseFields) => void; onCancel: () => void }) {
  const t = useTranslations("Farms");
  const typeId = useId();
  const [invalid, setInvalid] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const { text, num } = read(e.currentTarget);
    const parsed = HouseFields.safeParse({ name: text("houseName"), areaM2: num("areaM2"), capacity: num("capacity"), type: text("type") });
    setInvalid(!parsed.success);
    if (parsed.success) onSubmit(parsed.data);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-current/30 p-3">
      <Field name="houseName" label={t("houseName")} defaultValue={initial?.name} required maxLength={80} />
      <Field name="areaM2" label={t("areaM2")} defaultValue={initial?.areaM2} required inputMode="numeric" pattern="\d+" dir="ltr" />
      <Field name="capacity" label={t("capacity")} defaultValue={initial?.capacity} required inputMode="numeric" pattern="\d+" dir="ltr" />
      <div className="flex flex-col gap-1">
        <label htmlFor={typeId}>{t("type")}</label>
        <select id={typeId} name="type" defaultValue={initial?.type ?? "closed"} className={field}>
          {HOUSE_TYPES.map((type) => <option key={type} value={type}>{t(`types.${type}`)}</option>)}
        </select>
      </div>
      {invalid && <p role="alert">{t("invalid")}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("save")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("cancel")}</button>
      </div>
    </form>
  );
}
