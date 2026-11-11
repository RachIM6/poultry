import { z } from "zod";
import { DEATH_CAUSES } from "@/modules/flock/domain/daily-entry";

// SPEC B1–B6, the sync push's validation: the same schemas on every server path. The phone's screens import
// ./shared.ts (no Zod, ADR-009), re-exported here so server code and tests keep one import.
export * from "@/modules/flock/shared";

const text = (max: number) => z.string().trim().min(1).max(max);

export const PlaceBatch = z.object({
  id: z.uuid(),
  houseId: z.uuid(),
  strainId: z.string().min(1).max(60),
  placedOn: z.iso.date(), // farm day
  chicksPlaced: z.int().positive(),
  deadOnArrival: z.int().min(0),
  hatchery: text(120),
  deliveryNote: text(60),
  chickUnitPriceCentimes: z.string().regex(/^\d{1,12}$/), // JSON has no bigint
  dayOldWeightGrams: z.int().positive().nullable(),
});

/** B6: by hand, with a reason (the last sale closes it by itself). */
export const CloseBatch = z.object({ batchId: z.uuid(), day: z.iso.date(), reason: text(200) });

/** B6: another cost of the batch (electricity, labour…), until finance arrives in M2. */
export const RecordBatchCost = z.object({ id: z.uuid(), batchId: z.uuid(), day: z.iso.date(), label: text(120), amountCentimes: z.string().regex(/^\d{1,15}$/) });

export const RecordDay = z.object({
  batchId: z.uuid(),
  day: z.iso.date(),
  changes: z
    .object({
      dead: z.int().min(0),
      deathCause: z.enum(DEATH_CAUSES).nullable(),
      culled: z.int().min(0),
      feed: z.object({ stockItemId: z.uuid(), grams: z.int().positive() }).nullable(),
      waterMl: z.int().min(0).nullable(),
      note: z.string().trim().max(500).transform((s) => s || null).nullable(),
    })
    .partial()
    .refine((c) => Object.keys(c).length > 0, "no change"),
});

export const RecordWeighing = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  day: z.iso.date(),
  sample: z.union([
    z.object({ weightsGrams: z.array(z.int()).min(1).max(1000) }),
    z.object({ totalGrams: z.int(), count: z.int() }),
  ]),
});
