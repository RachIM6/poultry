import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import { DEATH_CAUSES, type DayFields } from "@/modules/flock/domain/daily-entry";

// SPEC B1, written offline: the phone and the sync push validate with the same schema (ADR-003). The phone also runs
// the same placement rules and age as the server.
export { Batch, ageOn } from "@/modules/flock/domain/batch";
export type { BatchStatus, PlacementError } from "@/modules/flock/domain/batch";

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

/** What pull returns and the phone stores. */
export type BatchDto = {
  id: string;
  farmId: string;
  houseId: string;
  species: "broiler";
  strainId: string;
  placedOn: string;
  chicksPlaced: number;
  deadOnArrival: number;
  hatchery: string;
  deliveryNote: string;
  dayOldWeightGrams: number | null;
  status: "open" | "closed";
  chickUnitPriceCentimes?: string; // money (SPEC I5): absent for workers
};
export const BATCH_MONEY = ["chickUnitPriceCentimes"] as const;

/** B5: birds that left alive, recorded by sales with the sale's id. No money: workers see birds on hand. */
export type SoldBirdsDto = { id: string; batchId: string; day: string; birds: number; liveWeightGrams: number };

export const FLOCK_MUTATIONS = { placeBatch: "flock.placeBatch", recordDay: "flock.recordDay", recordWeighing: "flock.recordWeighing" } as const;

// SPEC B2: the daily entry.
export { DEATH_CAUSES, EMPTY_DAY, changedFields, mergeDay } from "@/modules/flock/domain/daily-entry";
export type { DayFields, DeathCause } from "@/modules/flock/domain/daily-entry";

/** The entry of a batch on a farm day has one id everywhere: two phones entering that day write the same record. */
const DAILY_ENTRY_NAMESPACE = "3b6f1c1e-2a4d-4f5e-9c3b-7a1d2e4f6b80";
export const dailyEntryId = (batchId: string, day: string) => uuidv5(`${batchId}:${day}`, DAILY_ENTRY_NAMESPACE);

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

export type DailyEntryDto = { id: string; batchId: string; day: string } & DayFields;

// SPEC B3: weighings. The phone shows the same average, CV% and gap to the standard as the server computes.
export { MAX_SAMPLE, checkSample, sampleStats, versusStandard } from "@/modules/flock/domain/weighing";
export type { Sample } from "@/modules/flock/domain/weighing";

export const RecordWeighing = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  day: z.iso.date(),
  sample: z.union([
    z.object({ weightsGrams: z.array(z.int()).min(1).max(1000) }),
    z.object({ totalGrams: z.int(), count: z.int() }),
  ]),
});

/** `weightsGrams` is empty for a group weighing. */
export type WeighingDto = { id: string; batchId: string; day: string; count: number; totalGrams: number; weightsGrams: number[] };

// SPEC B4: live KPIs, computed on the phone from its local data.
export { batchKpis } from "@/modules/flock/domain/kpi";
export type { BatchKpis } from "@/modules/flock/domain/kpi";
