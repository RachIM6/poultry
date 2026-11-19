import { z } from "zod";
import { ProtocolItem, VACCINATION_METHODS } from "@/modules/reference-data/schema";

// SPEC H1–H6, the sync push's validation. The phone's screens import ./shared.ts (no Zod, ADR-009), re-exported here so
// server code and tests keep one import.
export * from "@/modules/health/shared";

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

export const RecordVetVisit = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  on: z.iso.date(), // farm day
  vetName: text(120),
  notes: z.string().trim().max(2000),
});
