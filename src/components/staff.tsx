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
import { ATTENDANCE, attendanceId, JOBS, monthEnd, payFor, payMonthId, rulesOn, TRAINING_TOPICS, WORKFORCE_MUTATIONS as W, type AdvanceDto, type AttendanceDto, type EmployeeDto, type LabourRules, type PayLine, type PayMonthDto, type PayPaymentDto, type StaffRecordDto, PAY_FROM, payPaymentId } from "@/modules/workforce/shared";
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
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "employee", "attendance", "advance", "labourRules", "payMonth", "payPayment", "staffRecord").toArray(), [scope.userId, scope.organizationId]);
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
      <Attendance employees={employees} attendance={of<AttendanceDto>("attendance")} onSave={(a) => writeLocal(db, { type: W.setAttendance, payload: a }, { entity: "attendance", id: a.id, data: a }).then(() => setMessage("Farms.saved"), () => setMessage("Farms.saveFailed"))} />
      <Advances employees={employees} advances={of<AdvanceDto>("advance")} onSave={(a) => writeLocal(db, { type: W.recordAdvance, payload: a }, { entity: "advance", id: a.id, data: a }).then(() => setMessage("Farms.saved"), () => setMessage("Farms.saveFailed"))} />
      <Records employees={employees} records={of<StaffRecordDto>("staffRecord")} onSave={(r) => writeLocal(db, { type: W.addStaffRecord, payload: r }, { entity: "staffRecord", id: r.id, data: r }).then(() => setMessage("Farms.saved"), () => setMessage("Farms.saveFailed"))} />
      <Pay scope={scope} farms={farms} employees={employees} attendance={of<AttendanceDto>("attendance")} advances={of<AdvanceDto>("advance")} rules={of<LabourRules>("labourRules")} months={of<PayMonthDto>("payMonth")} payments={of<PayPaymentDto>("payPayment")} write={(type, entity, data) => writeLocal(db, { type, payload: data }, { entity, id: data.id, data }).then(() => setMessage("Farms.saved"), () => setMessage("Farms.saveFailed"))} />
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

const CELL: Record<AttendanceDto["status"], string> = { present: "bg-olive-soft text-olive", rest: "bg-line text-ink-2", leave: "bg-chick-soft text-ink", absent: "bg-brick-soft text-brick-fg" };

/** WF9 (W-Staff "Présence"): the month's grid, filled by check-ins and by the form below. */
function Attendance({ employees, attendance, onSave }: { employees: EmployeeDto[]; attendance: AttendanceDto[]; onSave: (a: AttendanceDto) => Promise<void> }) {
  const t = useTranslations();
  const today = farmDayOf(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [status, setStatus] = useState<AttendanceDto["status"]>("present");
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const days = Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`).filter((d) => d <= today);
  const working = employees.filter((e) => e.startedOn <= `${month}-31` && (!e.leftOn || e.leftOn > `${month}-01`));
  if (working.length === 0) return null;

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const employee = working.find((e) => e.id === data.get("employee"))!;
    const day = String(data.get("day"));
    await onSave({ id: attendanceId(employee.id, day), farmId: employee.farmId, employeeId: employee.id, day, status, arrivedAt: status === "present" ? String(data.get("arrivedAt") || "") || null : null, userId: employee.userId });
  };

  return (
    <section aria-label={t("Attendance.title")} className="flex flex-col gap-3">
      <h2 className="text-[17px] font-semibold text-ink-2">{t("Attendance.title")}</h2>
      <input type="month" aria-label={t("Attendance.month")} value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className={field} />
      <div className="overflow-x-auto rounded-[18px] bg-card">
        <table className="text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky start-0 bg-card px-3 py-2 text-start font-medium text-ink-2">{t("Staff.name")}</th>
              {days.map((d) => <th key={d} scope="col" className="px-1 py-2 font-medium text-ink-2">{Number(d.slice(8))}</th>)}
            </tr>
          </thead>
          <tbody>
            {working.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <th scope="row" className="sticky start-0 bg-card px-3 py-2 text-start font-semibold">{e.name}</th>
                {days.map((d) => {
                  const a = attendance.find((x) => x.employeeId === e.id && x.day === d);
                  return (
                    <td key={d} className="px-1 py-1 text-center">
                      {a ? <span title={a.arrivedAt ?? undefined} className={`inline-grid h-7 min-w-7 place-items-center rounded-md text-xs font-semibold ${CELL[a.status]}`}>{t(`Attendance.short.${a.status}`)}</span> : <span className="text-muted">·</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-ink-2">{t("Attendance.legend")}</p>
      <form onSubmit={submit} className={card} aria-label={t("Attendance.set")}>
        <Field label={t("Attendance.employee")}>
          {(id) => (
            <select id={id} name="employee" className={field}>
              {working.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("Attendance.day")}>{(id) => <input id={id} name="day" type="date" required max={today} defaultValue={today} className={field} />}</Field>
        <Field label={t("Attendance.status")}>
          {(id) => (
            <select id={id} value={status} onChange={(e) => setStatus(e.target.value as AttendanceDto["status"])} className={field}>
              {ATTENDANCE.map((s) => <option key={s} value={s}>{t(`Attendance.statuses.${s}`)}</option>)}
            </select>
          )}
        </Field>
        {status === "present" && <Field label={t("Attendance.arrivedAtLabel")}>{(id) => <input id={id} name="arrivedAt" type="time" className={field} />}</Field>}
        <button type="submit" className={primary}>{t("Attendance.save")}</button>
      </form>
    </section>
  );
}

/** WF10 (W-Staff "Avance en cours"): advances still to be deducted, and a form to record one. */
function Advances({ employees, advances, onSave }: { employees: EmployeeDto[]; advances: AdvanceDto[]; onSave: (a: AdvanceDto) => Promise<void> }) {
  const t = useTranslations();
  const locale = useLocale();
  const [error, setError] = useState<string>();
  const [key, setKey] = useState(0); // a new key empties the form after a save
  const today = farmDayOf(new Date());
  const active = employees.filter((e) => !e.leftOn);
  if (active.length === 0) return null;
  const pending = advances.filter((a) => a.deductMonth >= today.slice(0, 7)).sort((x, y) => x.day.localeCompare(y.day));
  const name = (id: string) => employees.find((e) => e.id === id)?.name ?? "";

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const amount = parseCentimes(String(data.get("amount") ?? ""));
    if (amount === null || amount <= 0n) return setError("errors.INVALID_QUANTITY");
    const day = String(data.get("day"));
    const deductMonth = String(data.get("deductMonth"));
    if (deductMonth < day.slice(0, 7)) return setError("errors.DEDUCT_BEFORE_ADVANCE");
    setError(undefined);
    const employee = active.find((e) => e.id === data.get("employee"))!;
    await onSave({ id: uuidv7(), farmId: employee.farmId, employeeId: employee.id, day, amountCentimes: String(amount), deductMonth, note: String(data.get("note") ?? "").trim() || null });
    setKey((k) => k + 1);
  };

  return (
    <section aria-label={t("Advances.title")} className="flex flex-col gap-3">
      <h2 className="text-[17px] font-semibold text-ink-2">{t("Advances.title")}</h2>
      {pending.length > 0 && (
        <ul aria-label={t("Advances.pending")} className="flex flex-col gap-2">
          {pending.map((a) => (
            <li key={a.id} className="rounded-[18px] bg-chick-soft p-4">
              {t("Advances.line", { name: name(a.employeeId), amount: formatMoney(BigInt(a.amountCentimes)), date: formatDay(a.day as FarmDay, locale), month: a.deductMonth })}
            </li>
          ))}
        </ul>
      )}
      <form key={key} onSubmit={submit} className={card} aria-label={t("Advances.add")}>
        <Field label={t("Attendance.employee")}>
          {(id) => (
            <select id={id} name="employee" className={field}>
              {active.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("Advances.amount")}>{(id) => <input id={id} name="amount" inputMode="decimal" dir="ltr" required className={field} />}</Field>
        <Field label={t("Advances.day")}>{(id) => <input id={id} name="day" type="date" required max={today} defaultValue={today} className={field} />}</Field>
        <Field label={t("Advances.deductMonth")}>{(id) => <input id={id} name="deductMonth" type="month" required defaultValue={today.slice(0, 7)} className={field} />}</Field>
        <Field label={t("Expenses.note")}>{(id) => <input id={id} name="note" maxLength={200} className={field} />}</Field>
        {error && <p role="alert">{t(error)}</p>}
        <button type="submit" className={primary}>{t("Advances.save")}</button>
      </form>
    </section>
  );
}

/** WF13 (SCOPE §16): trainings and work accidents, the last ten, and a form. Never on a worker's phone. */
function Records({ employees, records, onSave }: { employees: EmployeeDto[]; records: StaffRecordDto[]; onSave: (r: StaffRecordDto) => Promise<void> }) {
  const t = useTranslations();
  const locale = useLocale();
  const [kind, setKind] = useState<StaffRecordDto["kind"]>("training");
  const [error, setError] = useState<string>();
  const [key, setKey] = useState(0); // a new key empties the form after a save
  const today = farmDayOf(new Date());
  if (employees.length === 0) return null;
  const name = (id: string) => employees.find((e) => e.id === id)?.name ?? "";
  const last = [...records].sort((x, y) => y.day.localeCompare(x.day) || y.id.localeCompare(x.id)).slice(0, 10);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const daysOff = get("daysOff") === "" ? null : Number(get("daysOff"));
    if (daysOff !== null && !(Number.isInteger(daysOff) && daysOff >= 0 && daysOff <= 365)) return setError("errors.INVALID_QUANTITY");
    if (kind === "accident" && get("note") === "") return setError("errors.INVALID_INPUT"); // only spaces passes "required"
    setError(undefined);
    const employee = employees.find((e) => e.id === data.get("employee"))!;
    const base = { id: uuidv7(), farmId: employee.farmId, employeeId: employee.id, day: get("day"), kind };
    await onSave(kind === "training" ? { ...base, topic: get("topic") as StaffRecordDto["topic"], note: get("note") || null, daysOff: null } : { ...base, topic: null, note: get("note"), daysOff });
    setKey((k) => k + 1);
  };

  return (
    <section aria-label={t("Records.title")} className="flex flex-col gap-3">
      <h2 className="text-[17px] font-semibold text-ink-2">{t("Records.title")}</h2>
      <p className="text-[13px] text-ink-2">{t("Records.private")}</p>
      {last.length > 0 && (
        <ul aria-label={t("Records.list")} className={`${card} gap-2`}>
          {last.map((r) => {
            const date = formatDay(r.day as FarmDay, locale);
            return (
              <li key={r.id}>
                {r.kind === "training" ? t("Records.training", { name: name(r.employeeId), topic: t(`Records.topics.${r.topic}`), date }) : t("Records.accident", { name: name(r.employeeId), date, note: r.note ?? "" })}
                {r.daysOff !== null && <span className="block text-sm text-ink-2">{t("Records.daysOffLine", { days: String(r.daysOff) })}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <form key={key} onSubmit={submit} className={card} aria-label={t("Records.add")}>
        <Field label={t("Records.kind")}>
          {(id) => (
            <select id={id} value={kind} onChange={(e) => setKind(e.target.value as StaffRecordDto["kind"])} className={field}>
              <option value="training">{t("Records.kinds.training")}</option>
              <option value="accident">{t("Records.kinds.accident")}</option>
            </select>
          )}
        </Field>
        <Field label={t("Attendance.employee")}>
          {(id) => (
            <select id={id} name="employee" className={field}>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("Records.day")}>{(id) => <input id={id} name="day" type="date" required max={today} defaultValue={today} className={field} />}</Field>
        {kind === "training" ? (
          <>
            <Field label={t("Records.topic")}>
              {(id) => (
                <select id={id} name="topic" className={field}>
                  {TRAINING_TOPICS.map((x) => <option key={x} value={x}>{t(`Records.topics.${x}`)}</option>)}
                </select>
              )}
            </Field>
            <Field label={t("Expenses.note")}>{(id) => <input id={id} name="note" maxLength={500} className={field} />}</Field>
          </>
        ) : (
          <>
            <Field label={t("Records.what")}>{(id) => <textarea id={id} name="note" required maxLength={500} rows={3} className={field} />}</Field>
            <Field label={t("Records.daysOff")}>{(id) => <input id={id} name="daysOff" inputMode="numeric" dir="ltr" className={field} />}</Field>
          </>
        )}
        {error && <p role="alert">{t(error)}</p>}
        <button type="submit" className={primary}>{t("Records.save")}</button>
      </form>
    </section>
  );
}

/** "4,48" → 448 basis points; null when empty, undefined when not a percentage with at most 2 decimals. */
function parseBp(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : undefined;
}

type PayProps = {
  scope: Scope;
  farms: FarmDto[];
  employees: EmployeeDto[];
  attendance: AttendanceDto[];
  advances: AdvanceDto[];
  rules: LabourRules[];
  months: PayMonthDto[];
  payments: PayPaymentDto[];
  write: <T extends { id: string }>(type: string, entity: string, data: T) => Promise<void>;
};

/** WF11, WF12 (W-Staff "Paie"): the month's pay as computed now, or as the owner froze it. No figure built in (§2). */
function Pay({ scope, farms, employees, attendance, advances, rules, months, payments, write }: PayProps) {
  const t = useTranslations();
  const locale = useLocale();
  const today = farmDayOf(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [farmId, setFarmId] = useState(farms[0].id);
  const [editingRules, setEditingRules] = useState(false);
  const inForce = rulesOn(rules, monthEnd(month));
  const frozen = months.find((p) => p.id === payMonthId(farmId, month));
  const working = employees.filter((e) => e.farmId === farmId && e.startedOn <= monthEnd(month) && (!e.leftOn || e.leftOn > `${month}-01`));
  const lines: PayLine[] =
    frozen?.lines ??
    working.map((e) =>
      payFor(month, { id: e.id, dailyWageCentimes: e.dailyWageCentimes ?? "0" }, attendance.filter((a) => a.employeeId === e.id), advances.filter((a) => a.employeeId === e.id), inForce),
    );
  const money = (c: string | null) => (c === null ? "—" : formatMoney(BigInt(c)));
  const sum = (pick: (l: PayLine) => string | null) => (lines.some((l) => pick(l) === null) ? null : String(lines.reduce((n, l) => n + BigInt(pick(l)!), 0n)));
  const name = (id: string) => employees.find((e) => e.id === id)?.name ?? "";
  const owner = can(scope, "workforce.validatePay");

  return (
    <section aria-label={t("Pay.title")} className="flex flex-col gap-3">
      <h2 className="text-[17px] font-semibold text-ink-2">{t("Pay.title")}</h2>
      <div className="flex gap-2">
        <input type="month" aria-label={t("Attendance.month")} value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${field} flex-1`} />
        {farms.length > 1 && (
          <select aria-label={t("Staff.farm")} value={farmId} onChange={(e) => setFarmId(e.target.value)} className={`${field} flex-1`}>
            {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
      </div>
      {frozen && <p className="font-medium">{t("Pay.validated", { date: formatDay(frozen.validatedOn as FarmDay, locale) })}</p>}
      <div className="overflow-x-auto rounded-[18px] bg-card">
        <table className="w-full text-sm" aria-label={t("Pay.table")}>
          <thead>
            <tr className="text-ink-2">
              <th scope="col" className="px-3 py-2 text-start font-medium">{t("Attendance.employee")}</th>
              <th scope="col" className="px-2 py-2 text-end font-medium">{t("Pay.days")}</th>
              <th scope="col" className="px-2 py-2 text-end font-medium">{t("Pay.gross")}</th>
              <th scope="col" className="px-2 py-2 text-end font-medium">{t("Pay.contribution")}</th>
              <th scope="col" className="px-2 py-2 text-end font-medium">{t("Pay.advances")}</th>
              <th scope="col" className="px-3 py-2 text-end font-medium">{t("Pay.net")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.employeeId} className="border-t border-line">
                <th scope="row" className="px-3 py-2 text-start font-semibold">
                  {name(l.employeeId)}
                  {l.belowSmag && <span className="block text-xs font-medium text-brick-fg">{t("Pay.belowSmag")}</span>}
                </th>
                <td className="px-2 py-2 text-end">{l.paidDays}</td>
                <td className="whitespace-nowrap px-2 py-2 text-end">{money(l.grossCentimes)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-end">{money(l.employeeContributionCentimes)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-end">{money(l.advancesCentimes)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-end font-semibold">{money(l.netCentimes)}</td>
              </tr>
            ))}
            <tr className="border-t border-line bg-shell font-semibold">
              <th scope="row" className="px-3 py-2 text-start">{t("Pay.total")}</th>
              <td />
              <td className="whitespace-nowrap px-2 py-2 text-end">{money(sum((l) => l.grossCentimes))}</td>
              <td className="whitespace-nowrap px-2 py-2 text-end">{money(sum((l) => l.employeeContributionCentimes))}</td>
              <td className="whitespace-nowrap px-2 py-2 text-end">{money(sum((l) => l.advancesCentimes))}</td>
              <td className="whitespace-nowrap px-3 py-2 text-end">{money(sum((l) => l.netCentimes))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {inForce ? (
        <p className="text-[13px] text-ink-2">{t("Pay.rulesInForce", { date: formatDay(inForce.validFrom as FarmDay, locale), source: inForce.source, employer: money(sum((l) => l.employerContributionCentimes)) })}</p>
      ) : (
        <p role="note" className="rounded-2xl bg-chick-soft p-3 text-[13px]">{t("Pay.rulesMissing")}</p>
      )}
      {owner && !frozen && lines.length > 0 && (
        <button
          type="button"
          onClick={() => write(W.validatePay, "payMonth", { id: payMonthId(farmId, month), farmId, month, lines, rulesId: inForce?.id ?? null, validatedOn: today, validatedBy: scope.userId } satisfies PayMonthDto)}
          className={primary}
        >
          {t("Pay.validate", { month })}
        </button>
      )}
      {owner && frozen && <WagesPaid farmId={farmId} month={month} net={sum((l) => (BigInt(l.netCentimes) > 0n ? l.netCentimes : "0")) ?? "0"} paid={payments.find((p) => p.id === payPaymentId(farmId, month))} today={today} write={write} />}
      {owner &&
        (editingRules ? (
          <RulesForm onCancel={() => setEditingRules(false)} onSave={(r) => write(W.saveLabourRules, "labourRules", r).then(() => setEditingRules(false))} />
        ) : (
          <button type="button" onClick={() => setEditingRules(true)} className={secondary}>{t("Pay.enterRules")}</button>
        ))}
    </section>
  );
}

/** WF12 follow-up: the validated month's wages paid out once, from the cash box or the bank (finance: D 4432 / C 5161 or 5141). */
function WagesPaid({ farmId, month, net, paid, today, write }: { farmId: string; month: string; net: string; paid?: PayPaymentDto; today: string; write: PayProps["write"] }) {
  const t = useTranslations();
  const locale = useLocale();
  if (paid) return <p className="font-medium">{t("Pay.paid", { amount: formatMoney(BigInt(paid.netCentimes)), date: formatDay(paid.day as FarmDay, locale), from: t(`Pay.from.${paid.paidFrom}`) })}</p>;
  if (net === "0") return null;
  const submit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const p: PayPaymentDto = { id: payPaymentId(farmId, month), farmId, month, day: String(data.get("day") || today), paidFrom: String(data.get("from")) as PayPaymentDto["paidFrom"], netCentimes: net };
    void write(W.payWages, "payPayment", p);
  };
  return (
    <form onSubmit={submit} aria-label={t("Pay.pay", { amount: formatMoney(BigInt(net)) })} className={`${card} gap-3`}>
      <Field label={t("Pay.payFrom")}>
        {(id) => (
          <select id={id} name="from" className={field}>
            {PAY_FROM.map((f) => <option key={f} value={f}>{t(`Pay.from.${f}`)}</option>)}
          </select>
        )}
      </Field>
      <Field label={t("Pay.payDay")}>{(id) => <input id={id} name="day" type="date" defaultValue={today} min={`${month}-01`} max={today} required className={field} />}</Field>
      <button type="submit" className={primary}>{t("Pay.pay", { amount: formatMoney(BigInt(net)) })}</button>
    </form>
  );
}

/** §2, MQ2: the owner types the figures their source gives, and names the source. Empty fields stay unknown. */
function RulesForm({ onSave, onCancel }: { onSave: (r: LabourRules) => Promise<void>; onCancel: () => void }) {
  const t = useTranslations();
  const [error, setError] = useState<string>();
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const dh = (k: string) => (get(k) === "" ? null : (parseCentimes(get(k)) ?? undefined));
    const [smag, cap] = [dh("smag"), dh("cap")];
    const rates = ["employeeCapped", "employeeUncapped", "employerCapped", "employerUncapped"].map((k) => parseBp(get(k)));
    if (smag === undefined || cap === undefined || rates.some((r) => r === undefined || (r !== null && r > 10_000))) return setError("errors.INVALID_QUANTITY");
    setError(undefined);
    const [ec, eu, rc, ru] = rates as (number | null)[];
    await onSave({ id: uuidv7(), validFrom: get("validFrom"), source: get("source"), smagDailyCentimes: smag === null ? null : String(smag), employeeCappedBp: ec, employeeUncappedBp: eu, employerCappedBp: rc, employerUncappedBp: ru, monthlyCapCentimes: cap === null ? null : String(cap) });
  };
  const pctField = (name: string, label: string) => <Field label={label}>{(id) => <input id={id} name={name} inputMode="decimal" dir="ltr" className={field} />}</Field>;
  return (
    <form onSubmit={submit} className={card} aria-label={t("Pay.enterRules")}>
      <p className="text-sm text-ink-2">{t("Pay.rulesHint")}</p>
      <Field label={t("Pay.source")}>{(id) => <input id={id} name="source" required minLength={3} maxLength={300} className={field} />}</Field>
      <Field label={t("Pay.validFrom")}>{(id) => <input id={id} name="validFrom" type="date" required className={field} />}</Field>
      <Field label={t("Pay.smag")}>{(id) => <input id={id} name="smag" inputMode="decimal" dir="ltr" className={field} />}</Field>
      {pctField("employeeCapped", t("Pay.employeeCapped"))}
      {pctField("employeeUncapped", t("Pay.employeeUncapped"))}
      {pctField("employerCapped", t("Pay.employerCapped"))}
      {pctField("employerUncapped", t("Pay.employerUncapped"))}
      <Field label={t("Pay.cap")}>{(id) => <input id={id} name="cap" inputMode="decimal" dir="ltr" className={field} />}</Field>
      {error && <p role="alert">{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Pay.saveRules")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("Receivables.cancel")}</button>
      </div>
    </form>
  );
}
