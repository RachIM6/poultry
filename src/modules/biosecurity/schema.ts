import { z } from "zod";
import { DISPOSAL_METHODS, MANURE_DESTINATIONS, VISIT_PURPOSES, ZONES } from "@/modules/biosecurity/shared";

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
