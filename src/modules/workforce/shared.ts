// What the phone's screens need from workforce, without Zod (ADR-009). The Zod schemas are in ./schema.ts.

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
} as const;
