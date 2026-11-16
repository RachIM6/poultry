"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDateTime, formatDay, formatKg } from "@/lib/format";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import {
  BIOSECURITY_MUTATIONS as B,
  CLEANOUT_STEPS,
  DISPOSAL_METHODS,
  MANURE_DESTINATIONS,
  VISIT_PURPOSES,
  VISITOR_RECENT_FARM_HOURS,
  ZONES,
  checkDisposal,
  checkStep,
  disposalGaps,
  downtimeDay,
  visitZone,
  type CleanoutDto,
  type CleanoutStepKey,
  type DisposalDto,
  type DowntimeSettingDto,
  type ManureRemovalDto,
  type VisitDto,
  type Zone,
} from "@/modules/biosecurity/shared";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import type { BatchDto, DailyEntryDto } from "@/modules/flock/shared";
import { parseQuantity } from "@/modules/inventory/shared";
import { currentScope, localDb, scopeKey, type LocalDb, type LocalRecord, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";

// SPEC-m2-compliance §4 on static shells, offline: the logs a farm keeps on the phone (visitors, BS1–BS3).

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const primary = "rounded-lg bg-green-700 px-4 py-3 font-semibold text-white";
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
      {message && <p role="status" className="rounded-lg bg-green-700/10 p-3">{t(message)}</p>}
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
            <li key={v.id} className="rounded-lg border border-current/30 p-3">
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
        {recentFarm && <p className="rounded-lg bg-amber-500/15 p-3">{t("Visitors.dirtyOnly")}</p>}
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

// BS6–BS7: what leaves the farm. Tabs, one log each.
const TABS = ["dead", "manure"] as const;
const GAP_DAYS = 14; // how far back the dead/disposed comparison looks on the phone: a screen choice, not a rule

export const DisposalScreen = () => <Shell entities={["farm", "house", "batch", "dailyEntry", "disposal", "manureRemoval"]} screen={Disposal} />;

type Choice = { id: string; label: string };
type Tab = (typeof TABS)[number];

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const t = useTranslations("Disposal");
  return (
    <div role="tablist" aria-label={t("tabs")} className="grid grid-cols-2 gap-1 rounded-lg border border-current/30 p-1">
      {TABS.map((k) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-11 rounded-md ${tab === k ? "bg-current/10 font-semibold" : ""}`}>
          {t(`tab.${k}`)}
        </button>
      ))}
    </div>
  );
}

function Disposal({ records, save }: Parameters<Screen>[0]) {
  const t = useTranslations("Disposal");
  const locale = useLocale();
  const picker = useFarm(records);
  const [tab, setTab] = useState<Tab>("dead");
  const { farm } = picker;
  if (!farm) return <p>{t("noFarm")}</p>;
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const houses = of<HouseDto>(records, "house").filter((h) => h.farmId === farm.id);
  const batches = of<BatchDto>(records, "batch").filter((b) => b.farmId === farm.id);
  const batchLabel = (id: string | null) => {
    const b = batches.find((x) => x.id === id);
    return b ? t("batch", { house: houses.find((h) => h.id === b.houseId)?.name ?? "—", date: day(b.placedOn) }) : null;
  };
  const choices: Choice[] = batches.filter((b) => b.status === "open").map((b) => ({ id: b.id, label: batchLabel(b.id)! }));

  return (
    <>
      <FarmPicker {...picker} />
      <Tabs tab={tab} setTab={setTab} />
      {tab === "dead" ? (
        <DeadBirds farmId={farm.id} records={records} batches={choices} batchLabel={batchLabel} day={day} save={save} />
      ) : (
        <Manure farmId={farm.id} records={records} houses={houses} batches={choices} day={day} save={save} />
      )}
    </>
  );
}

type LogProps = { farmId: string; records: LocalRecord[]; batches: Choice[]; day: (d: string) => string; save: Save };

function DeadBirds({ farmId, records, batches, batchLabel, day, save }: LogProps & { batchLabel: (id: string | null) => string | null }) {
  const t = useTranslations();
  const [method, setMethod] = useState<DisposalDto["method"]>("incineration");
  const [error, setError] = useState<string>();
  const [key, setKey] = useState(0);
  const today = farmDayOf(new Date());
  const since = addFarmDays(today, -GAP_DAYS);
  const farmBatches = new Set(of<BatchDto>(records, "batch").filter((b) => b.farmId === farmId).map((b) => b.id));
  const disposals = of<DisposalDto>(records, "disposal").filter((d) => d.farmId === farmId);
  const mortality = of<DailyEntryDto>(records, "dailyEntry")
    .filter((e) => farmBatches.has(e.batchId) && e.day >= since)
    .map((e) => ({ day: e.day, birds: e.dead + e.culled }));
  const gaps = disposalGaps(mortality, disposals.filter((d) => d.day >= since)).filter((g) => g.dead || g.disposed);
  const recent = disposals.sort((x, y) => y.day.localeCompare(x.day) || y.id.localeCompare(x.id)).slice(0, 20);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const birds = parseQuantity(get("birds"), "unit");
    const weightGrams = get("weight") ? parseQuantity(get("weight"), "kg") : null;
    if (birds === null || (get("weight") && weightGrams === null)) return setError("errors.INVALID_QUANTITY");
    const methodNote = get("methodNote") || null;
    const checked = checkDisposal({ method, methodNote });
    if (!checked.ok) return setError(`errors.${checked.error}`);
    if (get("day") > today) return setError("errors.DAY_IN_FUTURE");
    setError(undefined);
    const d: DisposalDto = { id: uuidv7(), farmId, day: get("day") || today, batchId: get("batch") || null, birds, weightGrams, method, methodNote };
    if (await save({ type: B.recordDisposal, payload: d }, "disposal", d)) {
      setKey((k) => k + 1);
      setMethod("incineration");
    }
  };

  return (
    <>
      <form key={key} onSubmit={submit} className="flex flex-col gap-3">
        <Field label={t("Disposal.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={today} max={today} required className={field} />}</Field>
        <Field label={t("Disposal.batchField")}>
          {(id) => (
            <select id={id} name="batch" className={field}>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              <option value="">{t("Disposal.noBatch")}</option>
            </select>
          )}
        </Field>
        <Field label={t("Disposal.birds")}>{(id) => <input id={id} name="birds" inputMode="numeric" required dir="ltr" className={field} />}</Field>
        <Field label={t("Disposal.weight")}>{(id) => <input id={id} name="weight" inputMode="decimal" dir="ltr" className={field} />}</Field>
        <Field label={t("Disposal.method")}>
          {(id) => (
            <select id={id} value={method} onChange={(e) => setMethod(e.target.value as DisposalDto["method"])} className={field}>
              {DISPOSAL_METHODS.map((k) => <option key={k} value={k}>{t(`Disposal.methods.${k}`)}</option>)}
            </select>
          )}
        </Field>
        {method === "other" && <Field label={t("Disposal.methodNote")}>{(id) => <input id={id} name="methodNote" required maxLength={200} className={field} />}</Field>}
        <p className="rounded-lg bg-amber-500/15 p-3 text-sm">{t("Disposal.toConfirm")}</p>
        {error && <p role="alert">{t(error)}</p>}
        <button type="submit" className={primary}>{t("Disposal.save")}</button>
      </form>

      <h2 className="text-lg font-semibold">{t("Disposal.gaps", { days: GAP_DAYS })}</h2>
      {gaps.length === 0 ? (
        <p>{t("Disposal.noGaps")}</p>
      ) : (
        <table className="w-full" aria-label={t("Disposal.gaps", { days: GAP_DAYS })}>
          <thead>
            <tr>
              <th className="text-start">{t("Disposal.day")}</th>
              <th className="text-end">{t("Disposal.dead")}</th>
              <th className="text-end">{t("Disposal.disposed")}</th>
              <th className="text-end">{t("Disposal.gap")}</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((g) => (
              <tr key={g.day} className={g.gap > 0 ? "font-semibold text-red-700" : ""}>
                <td>{day(g.day)}</td>
                <td className="text-end">{formatCount(g.dead)}</td>
                <td className="text-end">{formatCount(g.disposed)}</td>
                <td className="text-end">{formatCount(g.gap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="text-lg font-semibold">{t("Disposal.recent")}</h2>
      <ul className="flex flex-col gap-2" aria-label={t("Disposal.recent")}>
        {recent.map((d) => (
          <li key={d.id} className="rounded-lg border border-current/30 p-3">
            {t("Disposal.line", { date: day(d.day), birds: formatCount(d.birds), method: d.method === "other" ? (d.methodNote ?? "") : t(`Disposal.methods.${d.method}`) })}
            {d.weightGrams !== null && ` · ${formatKg(d.weightGrams)}`}
            {d.batchId && ` · ${batchLabel(d.batchId) ?? ""}`}
          </li>
        ))}
      </ul>
    </>
  );
}

function Manure({ farmId, records, houses, batches, day, save }: LogProps & { houses: HouseDto[] }) {
  const t = useTranslations();
  const [error, setError] = useState<string>();
  const [key, setKey] = useState(0);
  const today = farmDayOf(new Date());
  const recent = of<ManureRemovalDto>(records, "manureRemoval")
    .filter((r) => r.farmId === farmId)
    .sort((x, y) => y.day.localeCompare(x.day) || y.id.localeCompare(x.id))
    .slice(0, 20);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const quantityKg = parseQuantity(get("quantity"), "unit");
    if (quantityKg === null) return setError("errors.INVALID_QUANTITY");
    if (get("day") > today) return setError("errors.DAY_IN_FUTURE");
    setError(undefined);
    const r: ManureRemovalDto = {
      id: uuidv7(),
      farmId,
      day: get("day") || today,
      houseId: get("house") || null,
      batchId: get("batch") || null,
      quantityKg,
      destination: get("destination") as ManureRemovalDto["destination"],
      recipient: get("recipient") || null,
    };
    if (await save({ type: B.recordManure, payload: r }, "manureRemoval", r)) setKey((k) => k + 1);
  };

  return (
    <>
      <form key={key} onSubmit={submit} className="flex flex-col gap-3">
        <Field label={t("Disposal.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={today} max={today} required className={field} />}</Field>
        <Field label={t("Disposal.house")}>
          {(id) => (
            <select id={id} name="house" className={field}>
              {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              <option value="">{t("Disposal.noHouse")}</option>
            </select>
          )}
        </Field>
        <Field label={t("Disposal.batchField")}>
          {(id) => (
            <select id={id} name="batch" defaultValue="" className={field}>
              <option value="">{t("Disposal.noBatch")}</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("Disposal.quantity")}>{(id) => <input id={id} name="quantity" inputMode="numeric" required dir="ltr" className={field} />}</Field>
        <Field label={t("Disposal.destination")}>
          {(id) => (
            <select id={id} name="destination" className={field}>
              {MANURE_DESTINATIONS.map((k) => <option key={k} value={k}>{t(`Disposal.destinations.${k}`)}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("Disposal.recipient")}>{(id) => <input id={id} name="recipient" maxLength={120} className={field} />}</Field>
        {error && <p role="alert">{t(error)}</p>}
        <button type="submit" className={primary}>{t("Disposal.saveManure")}</button>
      </form>
      <h2 className="text-lg font-semibold">{t("Disposal.recentManure")}</h2>
      <ul className="flex flex-col gap-2" aria-label={t("Disposal.recentManure")}>
        {recent.map((r) => (
          <li key={r.id} className="rounded-lg border border-current/30 p-3">
            {t("Disposal.manureLine", { date: day(r.day), kg: formatCount(r.quantityKg), destination: t(`Disposal.destinations.${r.destination}`) })}
            {r.recipient && ` · ${r.recipient}`}
          </li>
        ))}
      </ul>
    </>
  );
}

// BS4–BS5: a house between two batches. The clean-out follows the house's last closed batch.
export const CleanoutScreen = () => <Shell entities={["farm", "house", "batch", "cleanout", "downtimeSetting"]} screen={Cleanouts} />;

function Cleanouts(props: Parameters<Screen>[0]) {
  const { records, save } = props;
  const t = useTranslations("Cleanout");
  const locale = useLocale();
  const picker = useFarm(records);
  const { farm } = picker;
  if (!farm) return <p>{t("noFarm")}</p>;
  const today = farmDayOf(new Date());
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const houses = of<HouseDto>(records, "house").filter((h) => h.farmId === farm.id).sort((x, y) => x.name.localeCompare(y.name));
  const batches = of<BatchDto>(records, "batch");
  const cleanouts = of<CleanoutDto>(records, "cleanout");
  const minDays = of<DowntimeSettingDto>(records, "downtimeSetting").find((s) => s.farmId === farm.id)?.minDays ?? null;

  return (
    <>
      <FarmPicker {...picker} />
      {can(props, "farms.manage") && <MinDowntime key={farm.id} farmId={farm.id} minDays={minDays} save={save} />}
      {houses.map((house) => {
        const last = batches.filter((b) => b.houseId === house.id).sort((x, y) => y.placedOn.localeCompare(x.placedOn))[0];
        if (!last) return null;
        const cleanout = cleanouts.find((c) => c.afterBatchId === last.id);
        const disinfectedOn = cleanout?.steps.find((s) => s.step === "disinfection")?.day ?? null;
        return (
          <section key={house.id} aria-label={house.name} className="flex flex-col gap-3 rounded-lg border border-current/30 p-3">
            <h2 className="text-lg font-semibold">{house.name}</h2>
            {last.status === "open" ? (
              <p>{t("busy", { date: day(last.placedOn) })}</p>
            ) : !cleanout ? (
              <>
                <p>{t("after", { date: day(last.placedOn) })}</p>
                <button
                  type="button"
                  className={primary}
                  onClick={() => {
                    const payload = { id: uuidv7(), houseId: house.id, afterBatchId: last.id, startedOn: today };
                    const local: CleanoutDto = { ...payload, farmId: farm.id, steps: [] };
                    void save({ type: B.startCleanout, payload }, "cleanout", local);
                  }}
                >
                  {t("start")}
                </button>
              </>
            ) : (
              <>
                <p className="rounded-lg bg-current/10 p-3 font-semibold" role="status">
                  {disinfectedOn
                    ? minDays === null
                      ? t("downtime", { day: downtimeDay(disinfectedOn as FarmDay, today) })
                      : t("downtimeOf", { day: downtimeDay(disinfectedOn as FarmDay, today), min: minDays, end: day(addFarmDays(disinfectedOn as FarmDay, minDays)) })
                    : t("notDisinfected")}
                </p>
                <Steps cleanout={cleanout} day={day} save={save} />
              </>
            )}
          </section>
        );
      })}
    </>
  );
}

function Steps({ cleanout, day, save }: { cleanout: CleanoutDto; day: (d: string) => string; save: Save }) {
  const t = useTranslations();
  const [open, setOpen] = useState<CleanoutStepKey>();
  const [error, setError] = useState<string>();
  const today = farmDayOf(new Date());

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!open) return;
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim() || null;
    const step = { id: uuidv7(), step: open, day: get("day") ?? today, product: get("product"), dose: get("dose"), productLot: get("productLot"), note: get("note") };
    const checked = checkStep(cleanout.steps, step);
    if (!checked.ok) return setError(`errors.${checked.error}`);
    if (step.day > today) return setError("errors.DAY_IN_FUTURE");
    setError(undefined);
    const next: CleanoutDto = { ...cleanout, steps: [...cleanout.steps, step] };
    if (await save({ type: B.recordCleanoutStep, payload: { ...step, cleanoutId: cleanout.id } }, "cleanout", next)) setOpen(undefined);
  };

  return (
    <ol className="flex flex-col gap-2">
      {CLEANOUT_STEPS.map((key, i) => {
        const done = cleanout.steps.find((s) => s.step === key);
        return (
          <li key={key} className="flex flex-col gap-2 border-t border-current/20 pt-2">
            <div className="flex items-center justify-between gap-2">
              <span>
                <span aria-hidden="true">{done ? "✓" : i + 1} </span>
                <span className={done ? "font-semibold" : ""}>{t(`Cleanout.steps.${key}`)}</span>
                {done && <span className="block text-sm opacity-75">{[day(done.day), done.product, done.dose, done.productLot && t("Cleanout.lot", { lot: done.productLot }), done.note].filter(Boolean).join(" · ")}</span>}
              </span>
              {!done && open !== key && (
                <button type="button" onClick={() => (setOpen(key), setError(undefined))} className="min-h-11 rounded-lg border border-current/30 px-3" aria-label={t("Cleanout.markNamed", { step: t(`Cleanout.steps.${key}`) })}>
                  {t("Cleanout.mark")}
                </button>
              )}
            </div>
            {open === key && (
              <form onSubmit={submit} className="flex flex-col gap-3">
                <Field label={t("Cleanout.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={today} max={today} required className={field} />}</Field>
                {key === "disinfection" && (
                  <>
                    <Field label={t("Cleanout.product")}>{(id) => <input id={id} name="product" required maxLength={120} className={field} />}</Field>
                    <Field label={t("Cleanout.dose")}>{(id) => <input id={id} name="dose" maxLength={60} className={field} />}</Field>
                    <Field label={t("Cleanout.productLot")}>{(id) => <input id={id} name="productLot" maxLength={60} dir="ltr" className={field} />}</Field>
                  </>
                )}
                <Field label={t("Cleanout.note")}>{(id) => <input id={id} name="note" maxLength={200} className={field} />}</Field>
                {error && <p role="alert">{t(error)}</p>}
                <button type="submit" className={primary}>{t("Cleanout.save")}</button>
              </form>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function MinDowntime({ farmId, minDays, save }: { farmId: string; minDays: number | null; save: Save }) {
  const t = useTranslations("Cleanout");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = String(new FormData(e.currentTarget).get("minDays") ?? "").trim();
    const value = text === "" ? null : Number(text);
    if (value !== null && !(Number.isInteger(value) && value >= 1 && value <= 365)) return;
    const s: DowntimeSettingDto = { id: farmId, farmId, minDays: value };
    await save({ type: B.setMinDowntime, payload: { farmId, minDays: value } }, "downtimeSetting", s);
  };
  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <Field label={t("minDays")}>{(id) => <input id={id} name="minDays" inputMode="numeric" pattern="\d*" defaultValue={minDays ?? ""} dir="ltr" className={field} />}</Field>
      <button type="submit" className="min-h-11 rounded-lg border border-current/30 px-3 py-3">{t("saveMin")}</button>
    </form>
  );
}
