import { z } from "zod";
import { isTaskKey, JOBS, taskDoneId, tickable } from "@/modules/workforce/shared";

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
