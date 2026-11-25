import { z } from "zod";
import { DEATH_CAUSES } from "@/modules/flock/domain/daily-entry";
import { BIRD_SEXES, PRODUCTION_TYPES } from "@/modules/reference-data/shared";

// SPEC B1–B6, the sync push's validation: the same schemas on every server path. The phone's screens import
// ./shared.ts (no Zod, ADR-009), re-exported here so server code and tests keep one import.
export * from "@/modules/flock/shared";

const text = (max: number) => z.string().trim().min(1).max(max);

export const PlaceBatch = z.object({
  id: z.uuid(),
  houseId: z.uuid(),
  species: z.enum(PRODUCTION_TYPES).default("broiler"), // SPEC-m3 R5; a placement queued by an M1 phone has none
  strainId: z.string().min(1).max(60),
  placedOn: z.iso.date(), // farm day
  chicksPlaced: z.int32().positive(),
  deadOnArrival: z.int32().min(0),
  hatchery: text(120),
  deliveryNote: text(60),
  chickUnitPriceCentimes: z.string().regex(/^\d{1,12}$/), // JSON has no bigint
  chickVatCentimes: z.string().regex(/^\d{1,12}$/).nullable().default(null), // SPEC-finance FN9, optional; an older phone sends none
  dayOldWeightGrams: z.int32().positive().nullable(),
  ageAtPlacementDays: z.int32().min(0).default(0), // SPEC-m3 B7; the domain caps it
  sex: z.enum(BIRD_SEXES).default("mixed"), // SPEC-m3 B9
  // SPEC-m3 B10, all optional.
  freeChicks: z.int32().min(0).default(0),
  parentFlock: z.string().trim().max(60).transform((s) => s || null).nullable().default(null),
  weakChicks: z.int32().min(0).nullable().default(null),
  litterTempTenths: z.int32().min(0).max(600).nullable().default(null),
  // SPEC-finance §9 "Chicks paid on delivery": paid in cash at delivery, from a cash box of finance's; an older phone sends none
  paidOnDelivery: z
    .object({ cashAccountId: z.uuid(), amountCentimes: z.string().regex(/^[1-9]\d{0,11}$/) })
    .nullable()
    .default(null),
});

/** B1: corrects an open batch's placement; only the fields that changed are sent (the server merges them). */
export const CorrectPlacement = z.object({
  batchId: z.uuid(),
  changes: z
    .object({
      houseId: z.uuid(),
      strainId: z.string().min(1).max(60),
      placedOn: z.iso.date(),
      chicksPlaced: z.int32().positive(),
      freeChicks: z.int32().min(0),
      deadOnArrival: z.int32().min(0),
      hatchery: text(120),
      deliveryNote: text(60),
      chickUnitPriceCentimes: z.string().regex(/^\d{1,12}$/),
      chickVatCentimes: z.string().regex(/^\d{1,12}$/).nullable(), // SPEC-finance FN9; null: none
    })
    .partial()
    .refine((c) => Object.keys(c).length > 0, "no change"),
});

/** SPEC-m3 B13: pullets move to a laying house, which starts a layer batch with their age. */
export const TransferToLaying = z.object({ batchId: z.uuid(), day: z.iso.date(), newBatchId: z.uuid(), houseId: z.uuid(), hens: z.int32().positive() });

/** B6: by hand, with a reason (the last sale closes it by itself). */
export const CloseBatch = z.object({ batchId: z.uuid(), day: z.iso.date(), reason: text(200) });

/** B6 "Reopening": the owner opens a closed batch again, with a reason. */
export const ReopenBatch = z.object({ batchId: z.uuid(), reason: text(200) });

/** B6: another cost of the batch, refused since SPEC-finance FN13 (an old phone may still send one). */
export const RecordBatchCost = z.object({ id: z.uuid(), batchId: z.uuid(), day: z.iso.date(), label: text(120), amountCentimes: z.string().regex(/^\d{1,15}$/) });

export const RecordDay = z.object({
  batchId: z.uuid(),
  day: z.iso.date(),
  changes: z
    .object({
      dead: z.int32().min(0),
      deathCause: z.enum(DEATH_CAUSES).nullable(),
      culled: z.int32().min(0),
      feed: z.object({ stockItemId: z.uuid(), grams: z.int32().positive() }).nullable(),
      waterMl: z.int32().min(0).nullable(),
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
    z.object({ weightsGrams: z.array(z.int32()).min(1).max(1000) }),
    z.object({ totalGrams: z.int32(), count: z.int32() }),
  ]),
});
