"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, useSyncExternalStore, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { formatCount } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import { Batch, FLOCK_MUTATIONS as M, ageOn, type BatchDto, type DailyEntryDto } from "@/modules/flock/schema";
import type { StockItemDto } from "@/modules/inventory/schema";
import { DayForm, type Write } from "@/components/daily-entry";
import { cachedReference, currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";

// SPEC B1 on the static /batches shell: from and to the phone's database (ADR-003). The one-open-batch rule is checked
// here for a quick answer and enforced by the server, which rejects the second of two phones placing offline.

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const primary = "rounded-lg bg-green-700 px-4 py-3 font-semibold text-white";
const secondary = "rounded-lg border border-current/30 px-4 py-3";
const today = () => farmDayOf(new Date());

// A batch's day opens as /batches#<id>: the path stays the precached shell, offline included.
const onHashChange = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const useHash = () => useSyncExternalStore(onHashChange, () => decodeURIComponent(window.location.hash.slice(1)), () => "");

export function BatchesScreen() {
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
  return <Batches key={scopeKey(scope)} {...scope} />;
}

function Batches(scope: Scope) {
  const { userId, organizationId, role } = scope;
  const t = useTranslations();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "batch", "dailyEntry", "stockItem").toArray(), [userId, organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const [placing, setPlacing] = useState(false);
  const [message, setMessage] = useState<string>();
  const openId = useHash();
  if (!records || reference === undefined) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const farms = new Map(of<FarmDto>("farm").map((f) => [f.id, f]));
  const houses = of<HouseDto>("house");
  const openFirst = (b: BatchDto) => (b.status === "open" ? 0 : 1);
  const batches = of<BatchDto>("batch").sort((x, y) => openFirst(x) - openFirst(y) || y.placedOn.localeCompare(x.placedOn));
  const strains = reference?.data.strains ?? [];
  const houseName = (id: string) => houses.find((h) => h.id === id)?.name ?? "";
  const busy = new Set(batches.filter((b) => b.status === "open").map((b) => b.houseId));
  const entries = of<DailyEntryDto>("dailyEntry");
  const entriesOf = (batchId: string) => entries.filter((e) => e.batchId === batchId);
  const onHand = (b: BatchDto) => b.chicksPlaced - b.deadOnArrival - entriesOf(b.id).reduce((n, e) => n + e.dead + e.culled, 0);

  const write: Write = async (mutation, recs) => {
    try {
      await writeLocal(db, mutation, recs);
      setMessage("Farms.saved");
      return true;
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
      return false;
    }
  };

  const open = batches.find((b) => b.id === openId && b.status === "open");
  if (open) {
    return (
      <>
        <a href="#" className="underline underline-offset-4">{t("Day.back")}</a>
        <h2 className="text-xl font-semibold">{t("Batches.summary", { farm: farms.get(open.farmId)?.name ?? "", house: houseName(open.houseId), strain: strains.find((s) => s.id === open.strainId)?.name ?? open.strainId })}</h2>
        <p>{t("Batches.age", { age: String(ageOn(open.placedOn as FarmDay, today())) })} · {t("Day.onHand", { birds: formatCount(onHand(open)) })}</p>
        {message && <p role="status" className="rounded-lg bg-green-700/10 p-3">{t(message)}</p>}
        <DayForm
          batch={open}
          entries={entriesOf(open.id)}
          feedItems={of<StockItemDto>("stockItem").filter((i) => i.farmId === open.farmId && i.kind === "feed")}
          write={write}
        />
      </>
    );
  }

  const save = async (batch: BatchDto, payload: unknown) => {
    try {
      await writeLocal(db, { type: M.placeBatch, payload }, [{ entity: "batch", id: batch.id, data: batch }]);
      setMessage("Farms.saved");
      setPlacing(false);
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
    }
  };

  return (
    <>
      {message && <p role="status" className="rounded-lg bg-green-700/10 p-3">{t(message)}</p>}
      {batches.length === 0 ? (
        <p>{t("Batches.none")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {batches.map((b) => (
            <li key={b.id} className="flex flex-col gap-1 rounded-lg border border-current/30 p-3">
              <span className="font-semibold">
                {b.status === "open" ? t("Batches.age", { age: String(ageOn(b.placedOn as FarmDay, today())) }) : t("Batches.status.closed")}
              </span>
              <span>
                {t("Batches.summary", { farm: farms.get(b.farmId)?.name ?? "", house: houseName(b.houseId), strain: strains.find((s) => s.id === b.strainId)?.name ?? b.strainId })}
              </span>
              <span className="text-sm opacity-75">{t("Batches.chicks", { chicks: formatCount(b.chicksPlaced), doa: formatCount(b.deadOnArrival) })}</span>
              <span>{t("Day.onHand", { birds: formatCount(onHand(b)) })}</span>
              {b.status === "open" && (
                <a href={`#${b.id}`} className={`${primary} mt-2 text-center`}>{t("Day.open")}</a>
              )}
            </li>
          ))}
        </ul>
      )}
      {can(scope, "flock.manage") &&
        (houses.length === 0 ? (
          <p>
            {t("Batches.noHouse")} <Link href="/farms" className="underline underline-offset-4">{t("Farms.title")}</Link>
          </p>
        ) : strains.length === 0 ? (
          <p>{t("Protocol.noReference")}</p> // strains come with the reference data, after one sync online
        ) : placing ? (
          <PlacementForm
            houses={houses.map((h) => ({ ...h, label: `${farms.get(h.farmId)?.name ?? ""} · ${h.name}`, busy: busy.has(h.id) }))}
            strains={strains}
            onSave={save}
            onCancel={() => setPlacing(false)}
          />
        ) : (
          <button type="button" onClick={() => setPlacing(true)} className={primary}>{t("Batches.place")}</button>
        ))}
    </>
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

function Select({ label, name, children }: { label: string; name: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} className={field}>{children}</select>
    </div>
  );
}

function PlacementForm({
  houses,
  strains,
  onSave,
  onCancel,
}: {
  houses: (HouseDto & { label: string; busy: boolean })[];
  strains: { id: string; name: string }[];
  onSave: (batch: BatchDto, payload: unknown) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const house = houses.find((h) => h.id === get("houseId"));
    const price = parseCentimes(get("price") || "0");
    const int = (k: string) => (/^\d+$/.test(get(k)) ? Number(get(k)) : NaN);
    if (!house || price === null || !get("hatchery") || !get("deliveryNote")) return setError("Batches.invalid");
    if (house.busy) return setError("errors.HOUSE_HAS_OPEN_BATCH"); // the server enforces it too

    const placement = {
      id: uuidv7(),
      farmId: house.farmId,
      houseId: house.id,
      strainId: get("strainId"),
      placedOn: (get("placedOn") || today()) as FarmDay,
      chicksPlaced: int("chicksPlaced"),
      deadOnArrival: get("deadOnArrival") ? int("deadOnArrival") : 0,
      hatchery: get("hatchery"),
      deliveryNote: get("deliveryNote"),
      chickUnitPriceCentimes: price,
      dayOldWeightGrams: get("dayOldWeight") ? int("dayOldWeight") : null,
    };
    const batch = Batch.place(placement, today()); // the same rules as the server
    if (!batch.ok) return setError(batch.error === "INVALID_QUANTITY" ? "Batches.invalid" : `errors.${batch.error}`);
    setError(undefined);

    const sent = { ...placement, chickUnitPriceCentimes: String(price) }; // farmId is dropped by the schema: the server derives it
    await onSave({ ...sent, species: "broiler", status: "open" }, sent);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-current/30 p-3">
      <Select label={t("Batches.house")} name="houseId">
        {houses.map((h) => (
          <option key={h.id} value={h.id}>{h.busy ? t("Batches.houseBusy", { house: h.label }) : h.label}</option>
        ))}
      </Select>
      <Select label={t("Batches.strain")} name="strainId">
        {strains.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      <Field name="placedOn" label={t("Batches.placedOn")} type="date" defaultValue={today()} required />
      <Field name="chicksPlaced" label={t("Batches.chicksPlaced")} inputMode="numeric" pattern="\d+" required dir="ltr" />
      <Field name="deadOnArrival" label={t("Batches.deadOnArrival")} inputMode="numeric" pattern="\d+" defaultValue="0" dir="ltr" />
      <Field name="hatchery" label={t("Batches.hatchery")} required maxLength={120} />
      <Field name="deliveryNote" label={t("Batches.deliveryNote")} required maxLength={60} dir="ltr" />
      <Field name="price" label={t("Batches.chickPrice")} inputMode="decimal" required dir="ltr" />
      <Field name="dayOldWeight" label={t("Batches.dayOldWeight")} inputMode="numeric" pattern="\d+" dir="ltr" />
      {error && <p role="alert">{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Batches.save")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("Batches.cancel")}</button>
      </div>
    </form>
  );
}
