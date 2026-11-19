// What the phone's screens need from eggs, without Zod (ADR-009). The Zod schemas are in ./schema.ts, which re-exports
// this file.

export { EGG_CATEGORIES, EMPTY_COUNTS, checkCollection, downgradedIn, eggsIn } from "@/modules/eggs/domain/collection";
export type { EggCategory, EggCounts, EggSample } from "@/modules/eggs/domain/collection";
import type { EggCounts, EggSample } from "@/modules/eggs/domain/collection";

export const EGG_MUTATIONS = {
  recordCollection: "eggs.recordCollection",
  correctCollection: "eggs.correctCollection",
} as const;

/** SPEC-m3 E1: one collection of a layer batch. No money: workers see it all. */
export type EggCollectionDto = { id: string; batchId: string; day: string; counts: EggCounts; sample: EggSample };
