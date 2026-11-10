import { v5 as uuidv5 } from "uuid";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { planVaccinations } from "@/modules/health/domain/vaccination";
import type { ProtocolItem } from "@/modules/reference-data/schema";
import type { VACCINATION_METHODS } from "@/modules/reference-data/shared";

// What the phone's screens need from health, without Zod (ADR-009): the plan, the checks and the withdrawal rule the
// phone runs like the server. The Zod schemas are in ./schema.ts, which re-exports this file.
export { checkDone, remindedDueOn, statusOn } from "@/modules/health/domain/vaccination";
export type { DoneError, Reminder, VaccinationStatus } from "@/modules/health/domain/vaccination";
export { checkBatchDay, checkTreatment, withdrawalEnd, withdrawalUntil } from "@/modules/health/domain/withdrawal";

export type VaccinationMethod = (typeof VACCINATION_METHODS)[number];

export type VaccinationDto = {
  id: string;
  batchId: string;
  dayOfAge: number;
  dueOn: string; // farm day
  productId: string;
  method: VaccinationMethod;
  done: { on: string; stockItemId: string; doses: number; method: VaccinationMethod; byUserId: string } | null;
};

/** A line of a batch's plan has one id everywhere: the phone and the server number the plan the same way. */
const VACCINATION_NAMESPACE = "6c0a4e2b-8f3d-4b71-a5e9-2d7c1f9b3e48";
export const vaccinationId = (batchId: string, line: number) => uuidv5(`${batchId}:${line}`, VACCINATION_NAMESPACE);

/** H1: the batch's plan as records, built from the protocol the phone sent. */
export const planFor = (batchId: string, placedOn: FarmDay, items: readonly ProtocolItem[]): VaccinationDto[] =>
  planVaccinations(placedOn, items).map((v, line) => ({ id: vaccinationId(batchId, line), batchId, ...v, done: null }));

/** H3, H6: as recorded, with its withdrawal end computed by the domain rule. */
export type TreatmentDto = {
  id: string;
  batchId: string;
  stockItemId: string;
  quantity: number;
  dose: string;
  startOn: string;
  endOn: string;
  reason: string;
  prescriber: string;
  withdrawalDays: number;
  withdrawalEndsOn: string;
  byUserId: string;
};

/** H5, H6. */
export type VetVisitDto = { id: string; batchId: string; on: string; vetName: string; notes: string; byUserId: string };

export const HEALTH_MUTATIONS = {
  planVaccinations: "health.planVaccinations",
  recordVaccination: "health.recordVaccination",
  recordTreatment: "health.recordTreatment",
  recordVetVisit: "health.recordVetVisit",
} as const;
