"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { split } from "@/components/layout";
import { Scoped } from "@/components/scoped";
import { card, danger, done, field, primary, secondary } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { formatDay } from "@/lib/format";
import { farmDayOf, farmMinutesOf, type FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import type { BatchDto, DailyEntryDto } from "@/modules/flock/shared";
import type { VaccinationDto } from "@/modules/health/shared";
import { attendanceId, dayTasks, taskAssignmentId, taskDoneId, tickable, WORKFORCE_MUTATIONS as W, type AttendanceDto, type DayTask, type EmployeeDto, type OneOffTask, type Routine, type TaskAssignmentDto, type TaskDoneDto } from "@/modules/workforce/shared";
import { cachedReference, localDb, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";

// SPEC-m4 WF4–WF8 on the static /tasks shell (W-Tasks), offline. The day's list is computed on the phone by the same
// rule as the server (workforce/domain/tasks.ts); the owner and managers add routines and one-off tasks here.

export const TasksScreen = () => <Scoped>{(scope) => <Tasks {...scope} />}</Scoped>;

const ENTITIES = ["farm", "house", "batch", "dailyEntry", "vaccination", "employee", "routine", "oneOffTask", "taskDone", "taskAssignment", "attendance"];

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
    done: of<TaskDoneDto>("taskDone"),
    assignments: of<TaskAssignmentDto>("taskAssignment"),
  });
  // WF8: a worker sees their own tasks; owners and managers see the farm's, with who does each.
  const me = employees.find((e) => e.userId === scope.userId && e.farmId === farm.id && !e.leftOn);
  const shown = manage || !me ? tasks : tasks.filter((x) => x.assignees.includes(me.id));
  const doneCount = shown.filter((x) => x.done).length;
  const staff = employees.filter((e) => e.farmId === farm.id && e.startedOn <= today && (!e.leftOn || today < e.leftOn));
  // WF9: today's check-in of the signed-in worker, kept on the phone until it syncs.
  const mine = me && of<AttendanceDto>("attendance").find((x) => x.employeeId === me.id && x.day === today);
  const arrived = mine?.status === "present" ? (mine.arrivedAt ?? "") : null;

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

  const write = async (mutation: { type: string; payload: unknown }, entity: string, id: string, data: object | null) => {
    try {
      await writeLocal(db, mutation, { entity, id, data });
      setMessage("Farms.saved");
      return true;
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
      return false;
    }
  };
  const checkIn = () => {
    if (!me) return;
    const m = farmMinutesOf(new Date());
    const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const a: AttendanceDto = { id: attendanceId(me.id, today), farmId: farm.id, employeeId: me.id, day: today, status: "present", arrivedAt: time, userId: scope.userId };
    return write({ type: W.checkIn, payload: { id: a.id, employeeId: me.id, day: today, time } }, "attendance", a.id, a);
  };

  return (
    <>
      {farms.length > 1 && (
        <select aria-label={t("Staff.farm")} value={farm.id} onChange={(e) => setFarmId(e.target.value)} className={field}>
          {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}
      {me && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-lg font-semibold">{t("Tasks.hello", { name: me.name })}</p>
          {arrived ? (
            <span className="rounded-full bg-olive-soft px-3 py-1.5 text-[13px] font-medium text-olive">{t("Attendance.arrivedAt", { time: arrived })}</span>
          ) : (
            <button type="button" onClick={checkIn} className={secondary}>{t("Attendance.checkIn")}</button>
          )}
        </div>
      )}
      {!manage && !me && <p className={card}>{t("Tasks.notStaff")}</p>}
      {/* Wide screens, for those who assign: the day's list, and the tasks to add and the routines beside it.
          data-assign widens the page (tasks/page.tsx), in CSS: the worker's list stays narrow. */}
      <div data-assign={manage || undefined} className={manage ? split : "flex flex-col gap-5"}>
        <div className="flex flex-col gap-5">
          {shown.length > 0 && (
            <section aria-label={t("Tasks.progress")} className="flex items-center justify-between rounded-[18px] bg-ink px-4 py-3.5 text-shell">
              <span className="flex flex-col">
                <span className="text-[13px] text-sand">{t("Nav.today")}</span>
                <b className="text-xl font-semibold">{t("Tasks.doneOf", { done: String(doneCount), total: String(shown.length) })}</b>
              </span>
              <span className="flex gap-1" aria-hidden="true">
                {shown.map((x) => <span key={x.key} className={`h-2 w-[18px] rounded-sm ${x.done ? "bg-sand" : "bg-shell/20"}`} />)}
              </span>
            </section>
          )}
          {message && <p role="status" className={done}>{t(message)}</p>}
          {shown.length === 0 ? (
            <p className={card}>{t("Tasks.none")}</p>
          ) : (
            <ol aria-label={t("Tasks.today")} className="flex flex-col rounded-[18px] bg-card px-3.5 py-1">
              {shown.map((task) => {
                const body = (
                  <>
                    <span className="w-11 shrink-0 text-[13px] text-ink-2">{task.time ?? ""}</span>
                    <span className="flex flex-1 flex-col">
                      <b className={`text-[15px] font-semibold ${task.done ? "text-ink-2" : ""}`}>{label(task)}</b>
                      <span className="text-xs text-muted">{why(task)}</span>
                      {manage && <span className="text-xs text-muted">{t("Tasks.for", { names: names(task.assignees) })}</span>}
                    </span>
                  </>
                );
                const mark = `grid size-[34px] shrink-0 place-items-center rounded-full text-sm font-bold ${task.done ? "bg-ink-2 text-shell" : "bg-line"}`;
                const id = taskDoneId(task.key, today);
                const tick = { id, farmId: farm.id, key: task.key, day: today };
                const toggle = () =>
                  task.done
                    ? write({ type: W.untickTask, payload: { id } }, "taskDone", id, null)
                    : write({ type: W.tickTask, payload: tick }, "taskDone", id, { ...tick, byUserId: scope.userId });
                // WF6: routines and one-off tasks are ticked here; an entry or a vaccine is done by recording it on its batch.
                const assign = (employeeId: string) => {
                  const a: TaskAssignmentDto = { id: taskAssignmentId(scope.organizationId, task.key, today), farmId: farm.id, key: task.key, day: today, employeeId };
                  return write({ type: W.assignTask, payload: a }, "taskAssignment", a.id, a);
                };
                return (
                  <li key={task.key} className="flex flex-col border-t border-line py-1 first:border-t-0">
                    <span className="flex min-h-[62px] items-center gap-3">
                    {tickable(task.key) ? (
                      <>
                        <span className="flex flex-1 items-center gap-3">{body}</span>
                        <button type="button" onClick={toggle} aria-pressed={task.done} aria-label={t("Tasks.tick", { task: label(task) })} className={`${mark} min-h-11 min-w-11`}>
                          {task.done ? "✓" : ""}
                        </button>
                      </>
                    ) : (
                      <Link href={{ pathname: "/batches", hash: task.batchId ?? "" }} className="flex flex-1 items-center gap-3">
                        {body}
                        <span className={mark} aria-label={t(task.done ? "Tasks.done" : "Tasks.todo")}>{task.done ? "✓" : ""}</span>
                      </Link>
                    )}
                    </span>
                    {/* WF7: today's task given to someone else; the list below "Pour" follows. */}
                    {manage && staff.length > 0 && (
                      <select
                        aria-label={t("Tasks.assign", { task: label(task) })}
                        value={task.assignees.length === 1 ? task.assignees[0] : ""}
                        onChange={(e) => e.target.value && assign(e.target.value)}
                        className={`${field} mb-2 min-h-11 text-base`}
                      >
                        <option value="">{t("Tasks.assignTo")}</option>
                        {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="text-[13px] text-ink-2">{t("Tasks.source")}</p>
        </div>

        {manage && (
          <div className="flex flex-col gap-5">
            <OneOffs
              tasks={of<OneOffTask>("oneOffTask").filter((o) => o.farmId === farm.id && o.day >= today && !o.cancelled)}
              house={house}
              onCancel={(o) => write({ type: W.cancelTask, payload: { id: o.id } }, "oneOffTask", o.id, { ...o, cancelled: true })}
            />
            <OneOffForm farm={farm} houses={houses} employees={employees} today={today} onSave={(o) => write({ type: W.addTask, payload: o }, "oneOffTask", o.id, o)} />
            <Routines farm={farm} routines={routines} houses={houses} employees={employees} today={today} house={house} onSave={(r) => write({ type: W.saveRoutine, payload: r }, "routine", r.id, r)} />
          </div>
        )}
      </div>
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
type Where = { houseId: string | null; time: string | null; employeeId: string | null };

/** House, time and assignee: the same three fields for a one-off task and a routine (prefilled when editing one). */
function PlaceFields({ farm, houses, employees, value }: Place & { value?: Where }) {
  const t = useTranslations();
  return (
    <>
      <Field label={t("Tasks.house")}>
        {(id) => (
          <select id={id} name="houseId" defaultValue={value?.houseId ?? ""} className={field}>
            <option value="">{t("Staff.wholeFarm")}</option>
            {houses.filter((h) => h.farmId === farm.id).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}
      </Field>
      <Field label={t("Tasks.time")}>{(id) => <input id={id} name="time" type="time" defaultValue={value?.time ?? ""} className={field} />}</Field>
      <Field label={t("Tasks.assignee")}>
        {(id) => (
          <select id={id} name="employeeId" defaultValue={value?.employeeId ?? ""} className={field}>
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

/** WF5: the one-off tasks still to come, each cancelled after a confirmation (it then leaves the day's list). */
function OneOffs({ tasks, house, onCancel }: { tasks: OneOffTask[]; house: (id: string | null) => string; onCancel: (o: OneOffTask) => Promise<boolean> }) {
  const t = useTranslations();
  if (tasks.length === 0) return null;
  return (
    <section aria-label={t("Tasks.planned")} className="flex flex-col gap-3">
      <h2 className="text-[17px] font-semibold text-ink-2">{t("Tasks.planned")}</h2>
      <ul className="flex flex-col gap-2">
        {tasks.sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? "").localeCompare(b.time ?? "")).map((o) => (
          <li key={o.id} className={card}>
            <b className="font-semibold">{o.title} · {house(o.houseId)}</b>
            <span className="text-sm text-ink-2">{o.day}{o.time ? ` · ${o.time}` : ""}</span>
            <button type="button" onClick={() => confirm(t("Tasks.cancelConfirm", { title: o.title })) && onCancel(o)} className={`${secondary} self-start`}>
              {t("Tasks.cancelTask", { title: o.title })}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
  const locale = useLocale();
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  const active = routines.filter((r) => r.farmId === place.farm.id && (r.stopOn === null || r.stopOn > today)).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));

  return (
    <section aria-label={t("Tasks.routines")} className="flex flex-col gap-3">
      <h2 className="text-[17px] font-semibold text-ink-2">{t("Tasks.routines")}</h2>
      <ul className="flex flex-col gap-2" aria-label={t("Tasks.routines")}>
        {active.map((r) => (
          <li key={r.id} className={card}>
            <b className="font-semibold">{r.time ? `${r.time} · ` : ""}{r.title} · {house(r.houseId)}</b>
            <span className="text-sm text-ink-2">
              {t("Tasks.every", { count: r.everyDays })} · {r.fromAge !== null ? t("Tasks.fromAge", { day: String(r.fromAge) }) : t("Tasks.fromDay", { date: r.startOn ? formatDay(r.startOn as FarmDay, locale) : "" })}
            </span>
            <span className="flex flex-wrap gap-2">
              <button type="button" aria-expanded={editing !== null && editing !== "new" && editing.id === r.id} onClick={() => setEditing(r)} className={secondary}>{t("Tasks.edit", { title: r.title })}</button>
              <button type="button" onClick={() => onSave({ ...r, stopOn: today })} className={secondary}>{t("Tasks.stop", { title: r.title })}</button>
            </span>
          </li>
        ))}
      </ul>
      {editing ? (
        <RoutineForm
          key={editing === "new" ? "new" : editing.id}
          routine={editing === "new" ? null : editing}
          today={today}
          place={place}
          onSave={(r) => onSave(r).then((saved) => saved && setEditing(null))}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button type="button" aria-expanded={false} onClick={() => setEditing("new")} className={secondary}>{t("Tasks.addRoutine")}</button>
      )}
    </section>
  );
}

/** WF5: a new routine, or an edit of one. `saveRoutine` replaces the whole routine, so the edit form is the add form prefilled. */
function RoutineForm({ routine, today, place, onSave, onCancel }: { routine: Routine | null; today: string; place: Place; onSave: (r: Routine) => Promise<unknown>; onCancel: () => void }) {
  const t = useTranslations();
  const [from, setFrom] = useState<"day" | "age">(routine?.fromAge != null ? "age" : "day");
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const where = placeOf(data, place.farm.id);
    if (from === "age" && where.houseId === null) return setError("errors.HOUSE_REQUIRED");
    setError(undefined);
    await onSave({
      id: routine?.id ?? uuidv7(),
      ...where,
      title: String(data.get("title")).trim(),
      everyDays: Number(data.get("everyDays")),
      startOn: from === "day" ? String(data.get("startOn")) : null,
      fromAge: from === "age" ? Number(data.get("fromAge")) : null,
      stopOn: routine?.stopOn ?? null, // a stop day already set stays; "Arrêter" sets it
    });
  };
  const label = routine ? t("Tasks.edit", { title: routine.title }) : t("Tasks.addRoutine");
  return (
    <form onSubmit={submit} className={card} aria-label={label}>
      <h3 className="font-semibold">{label}</h3>
      <Field label={t("Tasks.task")}>{(id) => <input id={id} name="title" required maxLength={120} defaultValue={routine?.title} className={field} />}</Field>
      <Field label={t("Tasks.everyDays")}>{(id) => <input id={id} name="everyDays" type="number" min={1} max={365} required defaultValue={routine?.everyDays ?? 1} className={field} />}</Field>
      <fieldset className="flex flex-col gap-1">
        <legend>{t("Tasks.from")}</legend>
        <label className="flex min-h-11 items-center gap-3"><input type="radio" checked={from === "day"} onChange={() => setFrom("day")} className="size-5" />{t("Tasks.fromCalendar")}</label>
        <label className="flex min-h-11 items-center gap-3"><input type="radio" checked={from === "age"} onChange={() => setFrom("age")} className="size-5" />{t("Tasks.fromBatch")}</label>
      </fieldset>
      {from === "day" ? (
        <Field label={t("Tasks.startOn")}>{(id) => <input id={id} name="startOn" type="date" required defaultValue={routine?.startOn ?? today} className={field} />}</Field>
      ) : (
        <Field label={t("Tasks.fromAgeLabel")}>{(id) => <input id={id} name="fromAge" type="number" min={0} max={800} required defaultValue={routine?.fromAge ?? undefined} className={field} />}</Field>
      )}
      <PlaceFields {...place} value={routine ?? undefined} />
      {from === "age" && <p className="text-sm text-ink-2">{t("Tasks.needsHouse")}</p>}
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Tasks.saveRoutine")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("Receivables.cancel")}</button>
      </div>
    </form>
  );
}
