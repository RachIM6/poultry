"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Scoped } from "@/components/scoped";
import { card, done, field, primary, secondary } from "@/components/ui";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import { JOBS, WORKFORCE_MUTATIONS as W, type EmployeeDto } from "@/modules/workforce/shared";
import { localDb, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";

// SPEC-m4 WF1–WF3 on the static /staff shell (W-Staff), offline: the employees of each farm, added and edited by the
// owner or a manager. The server links the member who signs in with the employee's phone.

export const StaffScreen = () => <Scoped>{(scope) => <Staff {...scope} />}</Scoped>;

const EDITABLE = ["name", "job", "phone", "housedOnFarm", "startedOn", "leftOn", "houseIds", "dailyWageCentimes", "cnssNumber"] as const;

function Staff(scope: Scope) {
  const t = useTranslations();
  const locale = useLocale();
  const db = localDb(scope);
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "employee").toArray(), [scope.userId, scope.organizationId]);
  const [editing, setEditing] = useState<EmployeeDto | "new" | null>(null);
  const [message, setMessage] = useState<string>();
  if (!can(scope, "workforce.manage")) return <p>{t("Staff.forbidden")}</p>;
  if (!records) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const farms = of<FarmDto>("farm");
  const houses = of<HouseDto>("house");
  const employees = of<EmployeeDto>("employee").sort((x, y) => Number(!!x.leftOn) - Number(!!y.leftOn) || x.name.localeCompare(y.name));
  if (farms.length === 0) return <p>{t("Farms.none")}</p>;

  const save = async (e: EmployeeDto, before: EmployeeDto | null) => {
    // An edit sends only what changed: an edit of other fields on another phone survives (ADR-003 §5).
    const changes = before && Object.fromEntries(EDITABLE.filter((k) => JSON.stringify(e[k] ?? null) !== JSON.stringify(before[k] ?? null)).map((k) => [k, e[k]]));
    if (changes && Object.keys(changes).length === 0) return setEditing(null);
    const mutation = changes ? { type: W.updateEmployee, payload: { id: e.id, changes } } : { type: W.createEmployee, payload: e };
    try {
      await writeLocal(db, mutation, { entity: "employee", id: e.id, data: e });
      setMessage("Farms.saved");
      setEditing(null);
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
    }
  };

  return (
    <>
      {message && <p role="status" className={done}>{t(message)}</p>}
      {farms.map((farm) => (
        <section key={farm.id} aria-label={farm.name} className="flex flex-col gap-3">
          {farms.length > 1 && <h2 className="text-[17px] font-semibold text-ink-2">{farm.name}</h2>}
          <ul className="flex flex-col gap-2" aria-label={t("Staff.list")}>
            {employees.filter((e) => e.farmId === farm.id).map((e) => (
              <li key={e.id} className={card}>
                <span className="flex items-baseline justify-between gap-3">
                  <b className="text-lg font-semibold">{e.name}</b>
                  <span className="text-ink-2">{t(`Staff.jobs.${e.job}`)}</span>
                </span>
                <span className="text-sm text-ink-2">
                  {[
                    e.houseIds.map((h) => houses.find((x) => x.id === h)?.name).filter(Boolean).join(", ") || t("Staff.wholeFarm"),
                    e.dailyWageCentimes && t("Staff.wagePerDay", { amount: formatMoney(BigInt(e.dailyWageCentimes)) }),
                    e.housedOnFarm && t("Staff.housed"),
                    e.leftOn ? t("Staff.leftOn", { date: formatDay(e.leftOn as FarmDay, locale) }) : e.userId ? t("Staff.usesApp") : t("Staff.noApp"),
                  ].filter(Boolean).join(" · ")}
                </span>
                <button type="button" onClick={() => setEditing(e)} className={`${secondary} self-start`}>{t("Staff.edit", { name: e.name })}</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {editing ? (
        <EmployeeForm key={editing === "new" ? "new" : editing.id} employee={editing === "new" ? null : editing} farms={farms} houses={houses} onSave={save} onCancel={() => setEditing(null)} />
      ) : (
        <button type="button" onClick={() => setEditing("new")} className={primary}>{t("Staff.add")}</button>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

type FormProps = { employee: EmployeeDto | null; farms: FarmDto[]; houses: HouseDto[]; onSave: (e: EmployeeDto, before: EmployeeDto | null) => Promise<void>; onCancel: () => void };

function EmployeeForm({ employee, farms, houses, onSave, onCancel }: FormProps) {
  const t = useTranslations();
  const [farmId, setFarmId] = useState(employee?.farmId ?? farms[0].id);
  const [error, setError] = useState<string>();

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const wage = parseCentimes(get("wage"));
    if (wage === null) return setError("errors.INVALID_QUANTITY");
    const leftOn = get("leftOn") || null;
    if (leftOn && leftOn < get("startedOn")) return setError("errors.LEFT_BEFORE_START");
    setError(undefined);
    await onSave(
      {
        id: employee?.id ?? uuidv7(),
        farmId,
        name: get("name"),
        job: get("job") as EmployeeDto["job"],
        userId: employee?.userId ?? null,
        housedOnFarm: data.get("housed") === "on",
        startedOn: get("startedOn"),
        leftOn,
        houseIds: data.getAll("houses").map(String),
        phone: get("phone") || null,
        dailyWageCentimes: String(wage),
        cnssNumber: get("cnss") || null,
      },
      employee,
    );
  };

  const wage = employee?.dailyWageCentimes;
  return (
    <form onSubmit={submit} className={card} aria-label={employee ? t("Staff.edit", { name: employee.name }) : t("Staff.add")}>
      {!employee && farms.length > 1 && (
        <Field label={t("Staff.farm")}>
          {(id) => (
            <select id={id} value={farmId} onChange={(e) => setFarmId(e.target.value)} className={field}>
              {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
        </Field>
      )}
      <Field label={t("Staff.name")}>{(id) => <input id={id} name="name" required maxLength={120} defaultValue={employee?.name} className={field} />}</Field>
      <Field label={t("Staff.job")}>
        {(id) => (
          <select id={id} name="job" defaultValue={employee?.job ?? "worker"} className={field}>
            {JOBS.map((j) => <option key={j} value={j}>{t(`Staff.jobs.${j}`)}</option>)}
          </select>
        )}
      </Field>
      <Field label={t("Staff.phone")}>{(id) => <input id={id} name="phone" type="tel" inputMode="tel" dir="ltr" maxLength={20} defaultValue={employee?.phone ?? ""} className={field} />}</Field>
      <p className="text-sm text-ink-2">{t("Staff.phoneHint")}</p>
      <Field label={t("Staff.wage")}>{(id) => <input id={id} name="wage" inputMode="decimal" dir="ltr" required defaultValue={wage ? `${BigInt(wage) / 100n},${String(BigInt(wage) % 100n).padStart(2, "0")}` : ""} className={field} />}</Field>
      <Field label={t("Staff.startedOn")}>{(id) => <input id={id} name="startedOn" type="date" required defaultValue={employee?.startedOn ?? farmDayOf(new Date())} className={field} />}</Field>
      <Field label={t("Staff.cnss")}>{(id) => <input id={id} name="cnss" dir="ltr" maxLength={20} defaultValue={employee?.cnssNumber ?? ""} className={field} />}</Field>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" name="housed" defaultChecked={employee?.housedOnFarm ?? false} className="size-5" />
        {t("Staff.housedLabel")}
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend>{t("Staff.houses")}</legend>
        {houses.filter((h) => h.farmId === farmId).map((h) => (
          <label key={h.id} className="flex min-h-11 items-center gap-3">
            <input type="checkbox" name="houses" value={h.id} defaultChecked={employee?.houseIds.includes(h.id)} className="size-5" />
            {h.name}
          </label>
        ))}
      </fieldset>
      {employee && <Field label={t("Staff.leftOnLabel")}>{(id) => <input id={id} name="leftOn" type="date" defaultValue={employee.leftOn ?? ""} className={field} />}</Field>}
      {error && <p role="alert">{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Staff.save")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("Receivables.cancel")}</button>
      </div>
    </form>
  );
}
