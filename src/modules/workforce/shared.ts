// What the phone's screens need from workforce, without Zod (ADR-009). The Zod schemas are in ./schema.ts.
import { v5 as uuidv5 } from "uuid";

export { dayTasks, routineFalls, taskKey } from "@/modules/workforce/domain/tasks";
export type { DayTask, OneOffTask, Routine, TaskInputs } from "@/modules/workforce/domain/tasks";

export const JOBS = ["lead", "worker", "guard", "other"] as const;
export type Job = (typeof JOBS)[number];

/** SPEC-m4 WF1–WF3. Wage, CNSS number and phone are for owners and managers only (stripped on the server). */
export type EmployeeDto = {
  id: string;
  farmId: string;
  name: string;
  job: Job;
  userId: string | null; // the member who signs in with this employee's phone
  housedOnFarm: boolean;
  startedOn: string; // farm day
  leftOn: string | null;
  houseIds: string[];
  phone?: string | null;
  dailyWageCentimes?: string;
  cnssNumber?: string | null;
};
export const EMPLOYEE_PRIVATE = ["phone", "dailyWageCentimes", "cnssNumber"] as const;

export const WORKFORCE_MUTATIONS = {
  createEmployee: "workforce.createEmployee",
  updateEmployee: "workforce.updateEmployee",
  saveRoutine: "workforce.saveRoutine",
  addTask: "workforce.addTask",
  cancelTask: "workforce.cancelTask",
  tickTask: "workforce.tickTask",
  untickTask: "workforce.untickTask",
  assignTask: "workforce.assignTask",
  checkIn: "workforce.checkIn",
  setAttendance: "workforce.setAttendance",
} as const;

/** WF6: a routine or one-off task ticked done on a farm day. Its id is the same on every phone that ticks it. */
export type TaskDoneDto = { id: string; farmId: string; key: string; day: string; byUserId: string };
const TASK_DONE_NAMESPACE = "d3f35e33-d474-4c94-97ad-f5a5c9ddc21c";
export const taskDoneId = (key: string, day: string) => uuidv5(`${key}:${day}`, TASK_DONE_NAMESPACE);
/** Only these are ticked: an entry or a vaccine is done by recording it. */
export const tickable = (key: string) => /^(routine|oneoff):[0-9a-f-]{36}$/.test(key);

/** WF7: one day's task given to another employee. One record per task and day (the last write wins). */
export type TaskAssignmentDto = { id: string; farmId: string; key: string; day: string; employeeId: string };
const TASK_ASSIGNMENT_NAMESPACE = "d07f68b2-395f-458b-8e90-c0554fb09d40";
// The organisation is part of the id: no one else can take the id of this organisation's task and day first.
export const taskAssignmentId = (organizationId: string, key: string, day: string) => uuidv5(`${organizationId}:${key}:${day}`, TASK_ASSIGNMENT_NAMESPACE);
export const isTaskKey = (key: string) => /^(entry|vaccine|routine|oneoff):[0-9a-f-]{36}$/.test(key);

/** WF9: one status per employee and farm day. `userId`: the member linked to the employee, so they see their own days. */
export const ATTENDANCE = ["present", "rest", "leave", "absent"] as const;
export type AttendanceDto = { id: string; farmId: string; employeeId: string; day: string; status: (typeof ATTENDANCE)[number]; arrivedAt: string | null; userId: string | null };
const ATTENDANCE_NAMESPACE = "1d4fd01a-5d67-48af-81c2-bab647be8228";
export const attendanceId = (employeeId: string, day: string) => uuidv5(`${employeeId}:${day}`, ATTENDANCE_NAMESPACE);
