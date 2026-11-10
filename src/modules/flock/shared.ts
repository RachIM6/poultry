import { v5 as uuidv5 } from "uuid";
import type { DayFields } from "@/modules/flock/domain/daily-entry";

// What the phone's screens need from flock, without Zod (ADR-009): mutation names, plain DTO types and the domain
// rules the phone runs like the server. The Zod schemas are in ./schema.ts, which re-exports this file.

// SPEC B1: placement, age, closing.
export { Batch, ageOn } from "@/modules/flock/domain/batch";
export type { BatchStatus, PlacementError } from "@/modules/flock/domain/batch";
export { batchCost } from "@/modules/flock/domain/closing";

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
  // B6, once closed: the locked figures (the cost ones are money).
  closedOn?: string;
  closeReason?: string | null; // null: closed by the sale of its last birds
  soldGrams?: number;
  costCentimes?: string;
  costPerKgCentimes?: string | null;
};
export const BATCH_MONEY = ["chickUnitPriceCentimes", "costCentimes", "costPerKgCentimes"] as const;

/** B6: another cost of the batch. Money: the amount is absent for workers. */
export type BatchCostDto = { id: string; batchId: string; day: string; label: string; amountCentimes?: string };

/** B5: birds that left alive, recorded by sales with the sale's id. No money: workers see birds on hand. */
export type SoldBirdsDto = { id: string; batchId: string; day: string; birds: number; liveWeightGrams: number };

export const FLOCK_MUTATIONS = {
  placeBatch: "flock.placeBatch",
  recordDay: "flock.recordDay",
  recordWeighing: "flock.recordWeighing",
  closeBatch: "flock.closeBatch",
  recordBatchCost: "flock.recordBatchCost",
} as const;

// SPEC B2: the daily entry.
export { DEATH_CAUSES, EMPTY_DAY, changedFields, mergeDay } from "@/modules/flock/domain/daily-entry";
export type { DayFields, DeathCause } from "@/modules/flock/domain/daily-entry";

/** The entry of a batch on a farm day has one id everywhere: two phones entering that day write the same record. */
const DAILY_ENTRY_NAMESPACE = "3b6f1c1e-2a4d-4f5e-9c3b-7a1d2e4f6b80";
export const dailyEntryId = (batchId: string, day: string) => uuidv5(`${batchId}:${day}`, DAILY_ENTRY_NAMESPACE);

export type DailyEntryDto = { id: string; batchId: string; day: string } & DayFields;

// SPEC B3: weighings. The phone shows the same average, CV% and gap to the standard as the server computes.
export { MAX_SAMPLE, checkSample, sampleStats, versusStandard } from "@/modules/flock/domain/weighing";
export type { Sample } from "@/modules/flock/domain/weighing";

/** `weightsGrams` is empty for a group weighing. */
export type WeighingDto = { id: string; batchId: string; day: string; count: number; totalGrams: number; weightsGrams: number[] };

// SPEC B4: live KPIs, computed on the phone from its local data.
export { batchKpis } from "@/modules/flock/domain/kpi";
export type { BatchKpis } from "@/modules/flock/domain/kpi";
