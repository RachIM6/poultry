import { z } from "zod";
import { CLEANOUT_STEPS, DISPOSAL_METHODS, MANURE_DESTINATIONS, RODENT_ACTIONS, VISIT_PURPOSES, ZONES } from "@/modules/biosecurity/shared";

export * from "@/modules/biosecurity/shared";

// Offline writes (SPEC-m2-compliance BS1): the same schemas validate on the phone and in the sync push.
export const RecordVisit = z.object({
  id: z.uuid(),
  farmId: z.uuid(),
  enteredAt: z.iso.datetime({ offset: true }),
  visitor: z.string().trim().min(1).max(120),
  vehicle: z.string().trim().min(1).max(20).nullable(),
  purpose: z.enum(VISIT_PURPOSES),
  recentFarm: z.boolean(),
  wheelsDisinfected: z.boolean(),
  footbath: z.boolean(),
  farmClothing: z.boolean(),
  zone: z.enum(ZONES),
});
export type RecordVisit = z.infer<typeof RecordVisit>;

const note = (max: number) => z.string().trim().min(1).max(max).nullable();

export const RecordDisposal = z.object({
  id: z.uuid(),
  farmId: z.uuid(),
  day: z.iso.date(),
  batchId: z.uuid().nullable(),
  birds: z.int32().min(1).max(1_000_000),
  weightGrams: z.int32().min(1).max(100_000_000).nullable(),
  method: z.enum(DISPOSAL_METHODS),
  methodNote: note(200),
});
export type RecordDisposal = z.infer<typeof RecordDisposal>;

export const RecordManure = z.object({
  id: z.uuid(),
  farmId: z.uuid(),
  day: z.iso.date(),
  houseId: z.uuid().nullable(),
  batchId: z.uuid().nullable(),
  quantityKg: z.int32().min(1).max(10_000_000),
  destination: z.enum(MANURE_DESTINATIONS),
  recipient: note(120),
});
export type RecordManure = z.infer<typeof RecordManure>;

export const StartCleanout = z.object({ id: z.uuid(), houseId: z.uuid(), afterBatchId: z.uuid(), startedOn: z.iso.date() });
export type StartCleanout = z.infer<typeof StartCleanout>;

export const RecordCleanoutStep = z.object({
  id: z.uuid(),
  cleanoutId: z.uuid(),
  step: z.enum(CLEANOUT_STEPS),
  day: z.iso.date(),
  product: note(120),
  dose: note(60),
  productLot: note(60),
  note: note(200),
});
export type RecordCleanoutStep = z.infer<typeof RecordCleanoutStep>;

export const SetMinDowntime = z.object({ farmId: z.uuid(), minDays: z.int32().min(1).max(365).nullable() });

export const RecordRodentCheck = z.object({
  id: z.uuid(),
  farmId: z.uuid(),
  houseId: z.uuid().nullable(),
  day: z.iso.date(),
  action: z.enum(RODENT_ACTIONS),
  product: note(120),
});
