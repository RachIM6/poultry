import { z } from "zod";

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

export const FLOCK_MUTATIONS = { placeBatch: "flock.placeBatch" } as const;
