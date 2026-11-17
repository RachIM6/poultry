"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Scoped } from "@/components/scoped";
import { card, done, field, primary, secondary } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import type { BatchDto, DailyEntryDto } from "@/modules/flock/shared";
import type { VaccinationDto } from "@/modules/health/shared";
import { dayTasks, WORKFORCE_MUTATIONS as W, type DayTask, type EmployeeDto, type OneOffTask, type Routine } from "@/modules/workforce/shared";
import { cachedReference, localDb, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";

// SPEC-m4 WF4–WF8 on the static /tasks shell (W-Tasks), offline. The day's list is computed on the phone by the same
// rule as the server (workforce/domain/tasks.ts); the owner and managers add routines and one-off tasks here.

export const TasksScreen = () => <Scoped>{(scope) => <Tasks {...scope} />}</Scoped>;

const ENTITIES = ["farm", "house", "batch", "dailyEntry", "vaccination", "employee", "routine", "oneOffTask"];

function Tasks(scope: Scope) {
  const t = useTranslations();
  const locale = useLocale();
  const db = localDb(scope);
  const records = useLiveQuery(() => db.records.where("entity").anyOf(ENTITIES).toArray(), [scope.userId, scope.organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const [farmId, setFarmId] = useState<string>();
  const [message, setMessage] = useState<string>();
  if (!records || reference === undefined) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const farms = of<FarmDto>("farm");
  if (farms.length === 0) return <p>{t("Farms.none")}</p>;
  const farm = farms.find((f) => f.id === farmId) ?? farms[0];
  const houses = of<HouseDto>("house");
  const employees = of<EmployeeDto>("employee");
  const routines = of<Routine>("routine");
  const today = farmDayOf(new Date());
  const manage = can(scope, "workforce.manage");
  const tasks = dayTasks(farm.id, today, {
    batches: of<BatchDto>("batch"),
    entries: of<DailyEntryDto>("dailyEntry"),
    vaccinations: of<VaccinationDto>("vaccination"),
    employees,
    routines,
    oneOffs: of<OneOffTask>("oneOffTask"),
    done: [],
    assignments: [],
  });

  const house = (id: string | null) => (id === null ? t("Staff.wholeFarm") : (houses.find((h) => h.id === id)?.name ?? ""));
  const product = (id: string | null) => reference?.data.products.find((p) => p.id === id);
  const label = (task: DayTask) =>
    task.kind === "entry"
      ? t("Tasks.entry", { house: house(task.houseId) })
      : task.kind === "vaccine"
        ? `${(locale === "ar" ? product(task.productId)?.nameAr : product(task.productId)?.nameFr) ?? task.productId} · ${house(task.houseId)}`
        : `${task.title} · ${house(task.houseId)}`;
  const why = (task: DayTask) =>
    [
      task.kind === "vaccine" ? t(task.late ? "Tasks.late" : "Tasks.vaccine") : task.kind === "oneoff" ? t("Tasks.oneOff") : null,
      task.everyDays !== null ? t("Tasks.every", { count: task.everyDays }) : null,
      task.age !== null ? t("Tasks.age", { day: String(task.age) }) : null,
    ].filter(Boolean).join(" · ");
  const names = (ids: string[]) => ids.map((id) => employees.find((e) => e.id === id)?.name).filter(Boolean).join(", ") || t("Tasks.nobody");

  const write = async (mutation: { type: string; payload: unknown }, entity: string, data: { id: string }) => {
    try {
      await writeLocal(db, mutation, { entity, id: data.id, data });
      setMessage("Farms.saved");
      return true;
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
      return false;
    }
  };

  return (
    <>
      {farms.length > 1 && (
        <select aria-label={t("Staff.farm")} value={farm.id} onChange={(e) => setFarmId(e.target.value)} className={field}>
          {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}
      {message && <p role="status" className={done}>{t(message)}</p>}
      {tasks.length === 0 ? (
        <p className={card}>{t("Tasks.none")}</p>
      ) : (
        <ol aria-label={t("Tasks.today")} className="flex flex-col rounded-[18px] bg-card px-3.5 py-1">
          {tasks.map((task) => {
            const body = (
              <>
                <span className="w-11 shrink-0 text-[13px] text-ink-2">{task.time ?? ""}</span>
                <span className="flex flex-1 flex-col">
                  <b className={`text-[15px] font-semibold ${task.done ? "text-ink-2" : ""}`}>{label(task)}</b>
                  <span className="text-xs text-muted">{why(task)}</span>
                  {manage && <span className="text-xs text-muted">{t("Tasks.for", { names: names(task.assignees) })}</span>}
                </span>
                <span className={`grid size-[34px] shrink-0 place-items-center rounded-full text-sm font-bold ${task.done ? "bg-ink-2 text-shell" : "bg-line"}`} aria-label={t(task.done ? "Tasks.done" : "Tasks.todo")}>
                  {task.done ? "✓" : ""}
                </span>
              </>
            );
            return (
              <li key={task.key} className="flex min-h-[62px] items-center gap-3 border-t border-line first:border-t-0">
                {task.batchId ? <Link href={{ pathname: "/batches", hash: task.batchId }} className="flex flex-1 items-center gap-3">{body}</Link> : body}
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-[13px] text-ink-2">{t("Tasks.source")}</p>

      {manage && (
        <>
          <OneOffForm farm={farm} houses={houses} employees={employees} today={today} onSave={(o) => write({ type: W.addTask, payload: o }, "oneOffTask", o)} />
          <Routines farm={farm} routines={routines} houses={houses} employees={employees} today={today} house={house} onSave={(r) => write({ type: W.saveRoutine, payload: r }, "routine", r)} />
        </>
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

type Place = { farm: FarmDto; houses: HouseDto[]; employees: EmployeeDto[] };

/** House, time and assignee: the same three fields for a one-off task and a routine. */
function PlaceFields({ farm, houses, employees }: Place) {
  const t = useTranslations();
  return (
    <>
      <Field label={t("Tasks.house")}>
        {(id) => (
          <select id={id} name="houseId" className={field}>
            <option value="">{t("Staff.wholeFarm")}</option>
            {houses.filter((h) => h.farmId === farm.id).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}
      </Field>
      <Field label={t("Tasks.time")}>{(id) => <input id={id} name="time" type="time" className={field} />}</Field>
      <Field label={t("Tasks.assignee")}>
        {(id) => (
          <select id={id} name="employeeId" className={field}>
            <option value="">{t("Tasks.auto")}</option>
            {employees.filter((e) => e.farmId === farm.id && !e.leftOn).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
      </Field>
    </>
  );
}

const placeOf = (data: FormData, farmId: string) => ({
  farmId,
  houseId: String(data.get("houseId") || "") || null,
  time: String(data.get("time") || "") || null,
  employeeId: String(data.get("employeeId") || "") || null,
});

function OneOffForm({ today, onSave, ...place }: Place & { today: string; onSave: (o: OneOffTask) => Promise<boolean> }) {
  const t = useTranslations();
  const [key, setKey] = useState(0); // a new key empties the form after a save
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const saved = await onSave({ id: uuidv7(), ...placeOf(data, place.farm.id), day: String(data.get("day")), title: String(data.get("title")).trim(), cancelled: false });
    if (saved) setKey((k) => k + 1);
  };
  return (
    <form key={key} onSubmit={submit} className={card} aria-label={t("Tasks.add")}>
      <h2 className="text-[17px] font-semibold">{t("Tasks.add")}</h2>
      <Field label={t("Tasks.task")}>{(id) => <input id={id} name="title" required maxLength={120} className={field} />}</Field>
      <Field label={t("Tasks.day")}>{(id) => <input id={id} name="day" type="date" required min={today} defaultValue={today} className={field} />}</Field>
      <PlaceFields {...place} />
      <button type="submit" className={primary}>{t("Tasks.addSave")}</button>
    </form>
  );
}

function Routines({ routines, today, house, onSave, ...place }: Place & { routines: Routine[]; today: string; house: (id: string | null) => string; onSave: (r: Routine) => Promise<boolean> }) {
  const t = useTranslations();
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState<"day" | "age">("day");
  const [error, setError] = useState<string>();
  const active = routines.filter((r) => r.farmId === place.farm.id && (r.stopOn === null || r.stopOn > today)).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const where = placeOf(data, place.farm.id);
    if (from === "age" && where.houseId === null) return setError("errors.HOUSE_REQUIRED");
    setError(undefined);
    const saved = await onSave({
      id: uuidv7(),
      ...where,
      title: String(data.get("title")).trim(),
      everyDays: Number(data.get("everyDays")),
      startOn: from === "day" ? String(data.get("startOn")) : null,
      fromAge: from === "age" ? Number(data.get("fromAge")) : null,
      stopOn: null,
    });
    if (saved) setAdding(false);
  };

  return (
    <section aria-label={t("Tasks.routines")} className="flex flex-col gap-3">
      <h2 className="text-[17px] font-semibold text-ink-2">{t("Tasks.routines")}</h2>
      <ul className="flex flex-col gap-2" aria-label={t("Tasks.routines")}>
        {active.map((r) => (
          <li key={r.id} className={card}>
            <b className="font-semibold">{r.time ? `${r.time} · ` : ""}{r.title} · {house(r.houseId)}</b>
            <span className="text-sm text-ink-2">
              {t("Tasks.every", { count: r.everyDays })} · {r.fromAge !== null ? t("Tasks.fromAge", { day: String(r.fromAge) }) : t("Tasks.fromDay", { date: r.startOn ?? "" })}
            </span>
            <button type="button" onClick={() => onSave({ ...r, stopOn: today })} className={`${secondary} self-start`}>{t("Tasks.stop", { title: r.title })}</button>
          </li>
        ))}
      </ul>
      {adding ? (
        <form onSubmit={submit} className={card} aria-label={t("Tasks.addRoutine")}>
          <Field label={t("Tasks.task")}>{(id) => <input id={id} name="title" required maxLength={120} className={field} />}</Field>
          <Field label={t("Tasks.everyDays")}>{(id) => <input id={id} name="everyDays" type="number" min={1} max={365} required defaultValue={1} className={field} />}</Field>
          <fieldset className="flex flex-col gap-1">
            <legend>{t("Tasks.from")}</legend>
            <label className="flex min-h-11 items-center gap-3"><input type="radio" checked={from === "day"} onChange={() => setFrom("day")} className="size-5" />{t("Tasks.fromCalendar")}</label>
            <label className="flex min-h-11 items-center gap-3"><input type="radio" checked={from === "age"} onChange={() => setFrom("age")} className="size-5" />{t("Tasks.fromBatch")}</label>
          </fieldset>
          {from === "day" ? (
            <Field label={t("Tasks.startOn")}>{(id) => <input id={id} name="startOn" type="date" required defaultValue={today} className={field} />}</Field>
          ) : (
            <Field label={t("Tasks.fromAgeLabel")}>{(id) => <input id={id} name="fromAge" type="number" min={0} max={800} required className={field} />}</Field>
          )}
          <PlaceFields {...place} />
          {from === "age" && <p className="text-sm text-ink-2">{t("Tasks.needsHouse")}</p>}
          {error && <p role="alert">{t(error)}</p>}
          <div className="flex gap-3">
            <button type="submit" className={primary}>{t("Tasks.saveRoutine")}</button>
            <button type="button" onClick={() => setAdding(false)} className={secondary}>{t("Receivables.cancel")}</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={secondary}>{t("Tasks.addRoutine")}</button>
      )}
    </section>
  );
}
