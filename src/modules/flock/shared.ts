import { v5 as uuidv5 } from "uuid";
import type { DayFields } from "@/modules/flock/domain/daily-entry";
import type { BirdSex, ProductionType } from "@/modules/reference-data/shared";

// For modules that may depend on flock but not on reference-data (climate): the production types of a batch.
export { PRODUCTION_TYPES, type ProductionType } from "@/modules/reference-data/shared";

// What the phone's screens need from flock, without Zod (ADR-009): mutation names, plain DTO types and the domain
// rules the phone runs like the server. The Zod schemas are in ./schema.ts, which re-exports this file.

// SPEC B1: placement, age, closing.
export { Batch, TRANSFER_REASON, ageOfBatch, ageOn, birdsPlaced, birdsStarted, canJoinHouse, doaClaim } from "@/modules/flock/domain/batch";
export type { BatchStatus, PlacementError } from "@/modules/flock/domain/batch";
export { batchCost, checkPaidOnDelivery, chicksCost, liveCostPerKg } from "@/modules/flock/domain/closing";
export { birdsOnHand } from "@/modules/flock/domain/birds";
export { correctPlacement, houseFreeFrom, recordedOf } from "@/modules/flock/domain/correction"; // B1, the correction form's chunk
export type { CorrectionError, PlacementCorrection } from "@/modules/flock/domain/correction";
export { checkReopen, type ReopenError } from "@/modules/flock/domain/reopen"; // B6 "Reopening", the reopen form's chunk

/** What pull returns and the phone stores. */
export type BatchDto = {
  id: string;
  farmId: string;
  houseId: string;
  species: ProductionType;
  strainId: string;
  placedOn: string;
  chicksPlaced: number;
  deadOnArrival: number;
  hatchery: string;
  deliveryNote: string;
  dayOldWeightGrams: number | null;
  ageAtPlacementDays?: number; // SPEC-m3 B7; absent from a record pulled before M3 (= 0)
  sex?: BirdSex; // SPEC-m3 B9; absent = mixed
  freeChicks?: number; // SPEC-m3 B10; absent = 0
  parentFlock?: string | null;
  weakChicks?: number | null;
  litterTempTenths?: number | null;
  fromBatchId?: string | null; // SPEC-m3 B13: the pullet batch of a transferred layer batch
  status: "open" | "closed";
  chickUnitPriceCentimes?: string; // money (SPEC I5): absent for workers
  chickVatCentimes?: string | null; // money: SPEC-finance FN9, the delivery's VAT on top of the price; absent before it
  paidOnDelivery?: PaidOnDelivery | null; // money: SPEC-finance §9 "Chicks paid on delivery"; absent before it
  // B6, once closed: the locked figures (the cost ones are money). The cost ones are not shown: a screen shows FN13's
  // cost per kg, the same as /results (SPEC-finance §9 "One cost per kg").
  closedOn?: string;
  closeReason?: string | null; // null: closed by the sale of its last birds
  soldGrams?: number;
  costCentimes?: string;
  costPerKgCentimes?: string | null;
};
export const BATCH_MONEY = ["chickUnitPriceCentimes", "chickVatCentimes", "paidOnDelivery", "costCentimes", "costPerKgCentimes"] as const;
/** SPEC-finance §9 "Chicks paid on delivery": the cash box (finance's id) and the amount, at most the placement's total. */
export type PaidOnDelivery = { cashAccountId: string; amountCentimes: string };

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
  transferToLaying: "flock.transferToLaying",
  correctPlacement: "flock.correctPlacement",
  reopenBatch: "flock.reopenBatch",
} as const;

// SPEC B2: the daily entry.
export { DEATH_CAUSES, EMPTY_DAY, changedFields, mergeDay } from "@/modules/flock/domain/daily-entry";
export type { DayFields, DeathCause } from "@/modules/flock/domain/daily-entry";

/** The entry of a batch on a farm day has one id everywhere: two phones entering that day write the same record. */
const DAILY_ENTRY_NAMESPACE = "3b6f1c1e-2a4d-4f5e-9c3b-7a1d2e4f6b80";
export const dailyEntryId = (batchId: string, day: string) => uuidv5(`${batchId}:${day}`, DAILY_ENTRY_NAMESPACE);

export type DailyEntryDto = { id: string; batchId: string; day: string } & DayFields;

// SPEC B3: weighings. The phone shows the same average, CV% and gap to the standard as the server computes.
export { MAX_SAMPLE, checkSample, sampleStats, uniformityPercent, versusStandard } from "@/modules/flock/domain/weighing";
export type { Sample } from "@/modules/flock/domain/weighing";

/** `weightsGrams` is empty for a group weighing. */
export type WeighingDto = { id: string; batchId: string; day: string; count: number; totalGrams: number; weightsGrams: number[] };

// SPEC B4: live KPIs, computed on the phone from its local data.
export { batchKpis, closedBatchFigures, feedConversionRatio, waterPerFeed } from "@/modules/flock/domain/kpi";
export { shownFcrEpef } from "@/modules/flock/domain/shown-fcr";
export { hatcheryFigures } from "@/modules/flock/domain/hatcheries";
export { houseFigure, houseWeight, layingVersusStandard } from "@/modules/flock/domain/house-figures"; // SPEC-m3 D1, B9
export type { BatchKpis } from "@/modules/flock/domain/kpi";
