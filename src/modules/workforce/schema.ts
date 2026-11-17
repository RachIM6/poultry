import { z } from "zod";
import { JOBS } from "@/modules/workforce/shared";

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
