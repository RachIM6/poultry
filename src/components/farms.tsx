"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, useSyncExternalStore, type FormEvent, type InputHTMLAttributes } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDay } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { FARM_MUTATIONS as M, FarmFields, HOUSE_TYPES, HouseFields, type FarmDto, type HouseDto, type RegisterKeeper } from "@/modules/farm-registry/schema";
import { currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";
import { useInline } from "@/components/focus";
import { rowHead, rowTable } from "@/components/layout";
import { danger, field, primary, secondary } from "@/components/ui";

// SPEC F2–F4. Runs on the static /farms shell: everything comes from and goes to the phone's database (ADR-003).

const card = "flex flex-col gap-1 rounded-2xl border border-line bg-card p-3";
// Wide screens: the farms in a 360 px column, the open farm beside them (the first one until another is picked).
const master = "flex flex-col gap-5 lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-x-8";
const column = "flex flex-col gap-5";
const wideOnly = "hidden lg:flex lg:flex-col lg:gap-5";
// A house is a card on the phone, a table row from lg (layout.ts `row`, with this screen's own card).
const houseRow = `${card} lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-6 lg:rounded-none lg:border-0 lg:border-t lg:border-line lg:px-4`;

type Save = (mutation: { type: string; payload: unknown }, record: { entity: string; id: string; data: unknown }) => Promise<boolean>;

/** On the dashboard: what this phone holds, and the way in. */
export function FarmsLink({ userId, organizationId }: { userId: string; organizationId: string }) {
  const t = useTranslations("Farms");
  const farms = useLiveQuery(() => localDb({ userId, organizationId }).records.where("entity").equals("farm").count(), [userId, organizationId]);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line p-6 text-center">
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
  // The phone shows the list or the open farm; a wide screen shows both, so the list stays (hidden on the phone).
  const shown = open ?? (openId ? undefined : farms[0]);
  return (
    <>
      {message && <p role="status" className="rounded-lg bg-olive-soft p-3 text-olive">{t(message)}</p>}
      <div className={master}>
        <div className={openId ? wideOnly : column}>
          <FarmList farms={farms} houses={houses} manage={manage} save={save} selected={open?.id} />
        </div>
        {shown ? (
          <div className={open ? column : wideOnly}>
            <FarmDetail key={shown.id} farm={shown} houses={houses.filter((h) => h.farmId === shown.id)} manage={manage} save={save} />
          </div>
        ) : openId ? (
          <div className={column}>
            <a href="#" className="underline underline-offset-4 lg:hidden">{t("back")}</a>
            <p>{t("notFound")}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}

function FarmList({ farms, houses, manage, save, selected }: { farms: FarmDto[]; houses: HouseDto[]; manage: boolean; save: Save; selected?: string }) {
  const t = useTranslations("Farms");
  const { open: adding, opener, close } = useInline<"farm">();
  return (
    <>
      {farms.length === 0 ? (
        <p>{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {farms.map((f) => (
            <li key={f.id}>
              <a href={`#${f.id}`} aria-current={f.id === selected || undefined} className={`${card} lg:aria-[current=true]:border-ink`}>
                <span className="font-semibold">{f.name}</span>
                <span className="text-sm text-muted">
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
            onCancel={close}
            onSubmit={async (fields) => {
              const id = uuidv7();
              if (await save({ type: M.createFarm, payload: { id, ...fields } }, { entity: "farm", id, data: { id, ...fields } })) {
                close();
                window.location.hash = id;
              }
            }}
          />
        ) : (
          <button type="button" {...opener("farm")} className={`${primary} lg:self-start`}>{t("add")}</button>
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
  const { open, opener, close } = useInline<"farm" | "house">();
  const { id, ...stored } = farm;
  // A farm stored before the register's fields has none: not a change to send.
  const current: FarmFields = { holder: null, vet: null, technicianName: null, chickImportApproval: null, registerKeepers: [], ...stored };

  return (
    <>
      <a href="#" className="underline underline-offset-4 lg:hidden">{t("back")}</a>
      {open === "farm" ? (
        <FarmForm
          initial={current}
          onCancel={close}
          onSubmit={async (fields) => {
            const changes = changed(current, fields);
            if (Object.keys(changes).length === 0) return close();
            if (await save({ type: M.updateFarm, payload: { id, changes } }, { entity: "farm", id, data: { ...farm, ...changes } })) close();
          }}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{farm.name}</h2>
          <p>{[farm.commune, farm.province, farm.region].join(", ")}</p>
          {farm.gps && <p dir="ltr" className="text-sm text-muted">{`${farm.gps.lat}, ${farm.gps.lng}`}</p>}
          {farm.onssa && (
            <p className="text-sm">{t("onssaUntil", { number: farm.onssa.number, date: formatDay(farm.onssa.expiresOn as FarmDay, locale) })}</p>
          )}
          {manage && <button type="button" {...opener("farm")} aria-label={t("editNamed", { name: farm.name })} className={`${secondary} mt-2 self-start`}>{t("edit")}</button>}
        </div>
      )}

      <h2 className="text-[17px] font-semibold text-ink-2">{t("houses")}</h2>
      {houses.length === 0 ? (
        <p>{t("noHouses")}</p>
      ) : (
        <ul className={`${rowTable} lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]`} aria-label={t("houses")}>
          <li aria-hidden="true" className={rowHead}><span>{t("houseName")}</span></li>
          {houses.map((h) => <HouseRow key={h.id} house={h} manage={manage} save={save} />)}
        </ul>
      )}
      {manage &&
        (open === "house" ? (
          <HouseForm
            onCancel={close}
            onSubmit={async (fields) => {
              const houseId = uuidv7();
              const data = { id: houseId, farmId: id, ...fields };
              if (await save({ type: M.createHouse, payload: data }, { entity: "house", id: houseId, data })) close();
            }}
          />
        ) : (
          <button type="button" {...opener("house")} className={`${primary} lg:self-start`}>{t("addHouse")}</button>
        ))}
    </>
  );
}

function HouseRow({ house, manage, save }: { house: HouseDto; manage: boolean; save: Save }) {
  const t = useTranslations("Farms");
  const { open: editing, opener, close } = useInline<"house">();
  const { id, farmId, ...current } = house;
  if (editing) {
    return (
      <li className="lg:col-span-full lg:border-t lg:border-line lg:p-4">
        <HouseForm
          initial={current}
          onCancel={close}
          onSubmit={async (fields) => {
            const changes = changed(current, fields);
            if (Object.keys(changes).length === 0) return close();
            if (await save({ type: M.updateHouse, payload: { id, changes } }, { entity: "house", id, data: { id, farmId, ...current, ...changes } })) close();
          }}
        />
      </li>
    );
  }
  return (
    <li className={houseRow}>
      <span className="font-semibold">{house.name}</span>
      <span className="text-sm text-muted">
        {t("houseSummary", { area: formatCount(house.areaM2), capacity: formatCount(house.capacity), type: t(`types.${house.type}`) })}
      </span>
      {manage && <button type="button" {...opener("house")} aria-label={t("editNamed", { name: house.name })} className={`${secondary} mt-1 self-start py-2 lg:mt-0 lg:self-center`}>{t("edit")}</button>}
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
  // Arrêté 2126-05 art. 4: the register keepers, one row each; a row's inputs are named after its key.
  const [keepers, setKeepers] = useState<{ key: string; keeper?: RegisterKeeper }[]>(() => (initial?.registerKeepers ?? []).map((keeper) => ({ key: uuidv7(), keeper })));
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const { text, num } = read(e.currentTarget);
    const [lat, lng, number, expiresOn] = [num("lat"), num("lng"), text("onssaNumber"), text("onssaExpiresOn")];
    const claim = num("doaClaim"); // SPEC-m3 B10: entered in %, stored per mille
    const orNull = (k: string) => text(k) || null;
    const registerKeepers = keepers
      .map(({ key: k }) => ({ name: text(`${k}.name`), position: text(`${k}.position`), from: text(`${k}.from`), to: orNull(`${k}.to`) }))
      .filter((k) => k.name || k.position || k.from || k.to); // a row left empty
    const parsed = FarmFields.safeParse({
      name: text("name"),
      region: text("region"),
      province: text("province"),
      commune: text("commune"),
      gps: lat === undefined && lng === undefined ? null : { lat, lng },
      onssa: !number && !expiresOn ? null : { number, expiresOn },
      doaClaimThresholdPermille: claim === undefined ? null : Math.round(claim * 10),
      holder: text("holderName") || text("holderAddress") ? { name: text("holderName"), address: orNull("holderAddress") } : null,
      vet: text("vetName") || text("vetAddress") || text("vetPhone") ? { name: text("vetName"), address: orNull("vetAddress"), phone: orNull("vetPhone") } : null,
      technicianName: orNull("technicianName"),
      chickImportApproval: orNull("chickImportApproval"),
      registerKeepers,
    });
    setInvalid(!parsed.success);
    if (parsed.success) onSubmit(parsed.data);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field name="name" label={t("name")} defaultValue={initial?.name} required maxLength={120} autoFocus />
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
      <fieldset className="flex flex-col gap-2">
        <Field
          name="doaClaim"
          label={t("doaClaim")}
          defaultValue={initial?.doaClaimThresholdPermille == null ? undefined : String(initial.doaClaimThresholdPermille / 10)}
          inputMode="decimal"
          dir="ltr"
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1">{t("register")}</legend>
        <Field name="holderName" label={t("holderName")} defaultValue={initial?.holder?.name} maxLength={120} />
        <Field name="holderAddress" label={t("holderAddress")} defaultValue={initial?.holder?.address ?? undefined} maxLength={200} />
        <Field name="vetName" label={t("vetName")} defaultValue={initial?.vet?.name} maxLength={120} />
        <Field name="vetAddress" label={t("vetAddress")} defaultValue={initial?.vet?.address ?? undefined} maxLength={200} />
        <Field name="vetPhone" label={t("vetPhone")} defaultValue={initial?.vet?.phone ?? undefined} type="tel" maxLength={32} dir="ltr" />
        <Field name="technicianName" label={t("technicianName")} defaultValue={initial?.technicianName ?? undefined} maxLength={120} />
        <Field name="chickImportApproval" label={t("chickImportApproval")} defaultValue={initial?.chickImportApproval ?? undefined} maxLength={60} dir="ltr" />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1">{t("keepers")}</legend>
        {keepers.map(({ key: k, keeper }) => (
          <div key={k} className="flex flex-col gap-2 rounded-2xl border border-line p-3">
            <Field name={`${k}.name`} label={t("keeperName")} defaultValue={keeper?.name} maxLength={120} />
            <Field name={`${k}.position`} label={t("keeperPosition")} defaultValue={keeper?.position} maxLength={80} />
            <Field name={`${k}.from`} label={t("keeperFrom")} defaultValue={keeper?.from} type="date" />
            <Field name={`${k}.to`} label={t("keeperTo")} defaultValue={keeper?.to ?? undefined} type="date" />
            <button type="button" onClick={() => setKeepers((ks) => ks.filter((x) => x.key !== k))} className={`${secondary} self-start py-2`}>{t("removeKeeper")}</button>
          </div>
        ))}
        <button type="button" onClick={() => setKeepers((ks) => [...ks, { key: uuidv7() }])} className={`${secondary} self-start`}>{t("addKeeper")}</button>
      </fieldset>
      {invalid && <p role="alert" className={danger}>{t("invalid")}</p>}
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
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-3">
      <Field name="houseName" label={t("houseName")} defaultValue={initial?.name} required maxLength={80} autoFocus />
      <Field name="areaM2" label={t("areaM2")} defaultValue={initial?.areaM2} required inputMode="numeric" pattern="\d+" dir="ltr" />
      <Field name="capacity" label={t("capacity")} defaultValue={initial?.capacity} required inputMode="numeric" pattern="\d+" dir="ltr" />
      <div className="flex flex-col gap-1">
        <label htmlFor={typeId}>{t("type")}</label>
        <select id={typeId} name="type" defaultValue={initial?.type ?? "closed"} className={field}>
          {HOUSE_TYPES.map((type) => <option key={type} value={type}>{t(`types.${type}`)}</option>)}
        </select>
      </div>
      {invalid && <p role="alert" className={danger}>{t("invalid")}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("save")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("cancel")}</button>
      </div>
    </form>
  );
}
