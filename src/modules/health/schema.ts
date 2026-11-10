import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { planVaccinations } from "@/modules/health/domain/vaccination";
import { ProtocolItem, VACCINATION_METHODS } from "@/modules/reference-data/schema";

// SPEC H1, H2, written offline: the phone and the sync push validate with the same schemas and build the same plan.
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

// The protocol's lines travel with the plan: the plan is what this phone showed, even if another phone edits the
// protocol before it syncs.
export const PlanVaccinations = z.object({
  batchId: z.uuid(),
  protocolId: z.uuid(),
  items: z.array(ProtocolItem).min(1).max(50),
});

export const RecordVaccination = z.object({
  id: z.uuid(), // the plan line
  on: z.iso.date(), // farm day
  stockItemId: z.uuid(), // the vaccine lot, deducted from stock
  doses: z.int().positive(),
  method: z.enum(VACCINATION_METHODS),
});

const text = (max: number) => z.string().trim().min(1).max(max);

/** H3, H6: as recorded, with its withdrawal end computed by the domain rule. */
export type TreatmentDto = z.infer<typeof RecordTreatment> & { withdrawalEndsOn: string; byUserId: string };
export const RecordTreatment = z.object({
  id: z.uuidv7(), // a phone's id; never a daily entry's UUIDv5, whose consumption movement the entry may replace (T25)
  batchId: z.uuid(),
  stockItemId: z.uuid(), // the medicine lot, deducted from stock
  quantity: z.int().positive(), // the item's base unit
  dose: text(120), // as prescribed, e.g. "1 ml par litre d'eau"
  startOn: z.iso.date(), // farm days
  endOn: z.iso.date(),
  reason: text(200),
  prescriber: text(120),
  withdrawalDays: z.int().min(0).max(365), // from the label or the prescription: never a default (OQ4)
});

/** H5, H6. */
export type VetVisitDto = z.infer<typeof RecordVetVisit> & { byUserId: string };
export const RecordVetVisit = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  on: z.iso.date(), // farm day
  vetName: text(120),
  notes: z.string().trim().max(2000),
});

export const HEALTH_MUTATIONS = {
  planVaccinations: "health.planVaccinations",
  recordVaccination: "health.recordVaccination",
  recordTreatment: "health.recordTreatment",
  recordVetVisit: "health.recordVetVisit",
} as const;
