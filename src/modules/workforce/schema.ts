import { z } from "zod";
import { ATTENDANCE, attendanceId, isTaskKey, JOBS, taskDoneId, tickable, TRAINING_TOPICS } from "@/modules/workforce/shared";

// SPEC-m4 §4, the sync push's validation. The phone's screens import ./shared.ts (no Zod, ADR-009).
export * from "@/modules/workforce/shared";

const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullable();

export const EmployeeFields = z.object({
  name: text(120),
  job: z.enum(JOBS),
  phone: optional(20), // normalised to E.164 by the server; it links the member who signs in with it (WF2)
  housedOnFarm: z.boolean(),
  startedOn: z.iso.date(),
  leftOn: z.iso.date().nullable(),
  dailyWageCentimes: z.string().regex(/^\d{1,12}$/), // JSON has no bigint
  cnssNumber: optional(20),
  houseIds: z.array(z.uuid()).max(50),
});
export type EmployeeFields = z.infer<typeof EmployeeFields>;

export const CreateEmployee = EmployeeFields.extend({ id: z.uuid(), farmId: z.uuid() });
// Only the fields the user changed: concurrent edits of different fields both survive (ADR-003 §5).
export const UpdateEmployee = z.object({ id: z.uuid(), changes: EmployeeFields.partial().refine((c) => Object.keys(c).length > 0, "no change") });

// WF5: the manager's routines and one-off tasks.
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(); // "HH:MM" on the farm clock
const place = { farmId: z.uuid(), houseId: z.uuid().nullable(), employeeId: z.uuid().nullable() };

export const SaveRoutine = z
  .object({ id: z.uuid(), ...place, title: text(120), time, everyDays: z.int32().min(1).max(365), startOn: z.iso.date().nullable(), fromAge: z.int32().min(0).max(800).nullable(), stopOn: z.iso.date().nullable() })
  // Every n days from a calendar day, or from an age of the house's open batch: exactly one of the two.
  .refine((r) => (r.startOn === null) !== (r.fromAge === null) && (r.fromAge === null || r.houseId !== null), "calendar or batch routine");

export const AddTask = z.object({ id: z.uuid(), ...place, day: z.iso.date(), title: text(120), time });
export const CancelTask = z.object({ id: z.uuid() });

// WF6: the id is derived from the task and the day, so two phones ticking the same task converge on one record.
export const TickTask = z
  .object({ id: z.uuid(), farmId: z.uuid(), key: z.string().max(80), day: z.iso.date() })
  .refine((t) => tickable(t.key) && t.id === taskDoneId(t.key, t.day), "routine or one-off, id from key and day");
export const UntickTask = z.object({ id: z.uuid() });

export const AssignTask = z
  .object({ id: z.uuid(), farmId: z.uuid(), key: z.string().max(80), day: z.iso.date(), employeeId: z.uuid() })
  .refine((t) => isTaskKey(t.key), "a task key"); // the id is checked against the caller's organisation on apply

// WF9: the id is derived from employee and day, so a check-in and a manager's edit of that day meet on one record.
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const attendanceDay = { id: z.uuid(), employeeId: z.uuid(), day: z.iso.date() };
const idOk = (a: { id: string; employeeId: string; day: string }) => a.id === attendanceId(a.employeeId, a.day);
export const CheckIn = z.object({ ...attendanceDay, time: hhmm }).refine(idOk, "id from employee and day");
export const SetAttendance = z.object({ ...attendanceDay, status: z.enum(ATTENDANCE), arrivedAt: hhmm.nullable() }).refine(idOk, "id from employee and day");

export const RecordAdvance = z
  .object({ id: z.uuid(), employeeId: z.uuid(), day: z.iso.date(), amountCentimes: z.string().regex(/^[1-9]\d{0,11}$/), deductMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), note: optional(200) })
  .refine((a) => a.deductMonth >= a.day.slice(0, 7), "deducted in the month it is given or later");

// WF13: a training has a topic, an accident says what happened; days off only for an accident.
const record = { id: z.uuid(), employeeId: z.uuid(), day: z.iso.date() };
export const AddStaffRecord = z.discriminatedUnion("kind", [
  z.object({ ...record, kind: z.literal("training"), topic: z.enum(TRAINING_TOPICS), note: optional(500) }),
  z.object({ ...record, kind: z.literal("accident"), note: text(500), daysOff: z.int32().min(0).max(365).nullable() }),
]);

// §2, MQ2: each value is optional (the owner enters what their source gives); the source is not.
const centimes = z.string().regex(/^\d{1,12}$/);
const rate = z.int32().min(0).max(10_000).nullable(); // basis points: 1 % = 100
export const SaveLabourRules = z.object({
  id: z.uuid(),
  validFrom: z.iso.date(),
  source: z.string().trim().min(3).max(300),
  smagDailyCentimes: centimes.nullable(),
  employeeCappedBp: rate,
  employeeUncappedBp: rate,
  employerCappedBp: rate,
  employerUncappedBp: rate,
  monthlyCapCentimes: centimes.nullable(),
});
export const ValidatePay = z.object({ farmId: z.uuid(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
