// What the phone's screens need from eggs, without Zod (ADR-009). The Zod schemas are in ./schema.ts, which re-exports
// this file.

import { v5 as uuidv5 } from "uuid";

export { EGG_CATEGORIES, EMPTY_COUNTS, checkCollection, downgradedIn, eggsIn } from "@/modules/eggs/domain/collection";
export type { EggCategory, EggCounts, EggSample } from "@/modules/eggs/domain/collection";
import type { EggCounts, EggSample } from "@/modules/eggs/domain/collection";

export { AGE_BUCKETS, checkDiscard, checkGrading, drawFifo, eggLots, stockByAge, stockByItem } from "@/modules/eggs/domain/stock";
export type { EggItem, Lot } from "@/modules/eggs/domain/stock";
import type { EggItem } from "@/modules/eggs/domain/stock";

export { layerKpis } from "@/modules/eggs/domain/kpi";
export type { LayerKpis, LayerWeek } from "@/modules/eggs/domain/kpi";

export const EGG_MUTATIONS = {
  recordCollection: "eggs.recordCollection",
  correctCollection: "eggs.correctCollection",
  gradeEggs: "eggs.gradeEggs",
  discardEggs: "eggs.discardEggs",
} as const;

/** SPEC-m3 E3. */
export type EggGradingDto = { id: string; batchId: string; laidOn: string; grades: Record<string, number> };
export type EggDiscardDto = { id: string; batchId: string; laidOn: string; item: EggItem; eggs: number; reason: string };

/** SPEC-m3 E1: one collection of a layer batch. No money: workers see it all. */
export type EggCollectionDto = { id: string; batchId: string; day: string; counts: EggCounts; sample: EggSample };

/** SPEC-m3 V6: eggs a sale took from a lot. No money. */
export type EggDrawDto = { id: string; batchId: string; saleId: string; laidOn: string; item: EggItem; eggs: number };

/** V6: a draw's id, the same on the phone and the server: a UUIDv5 of the sale and the draw's place in it. */
const DRAW_NAMESPACE = "5d0c8a3e-7b1f-4c2a-9e6d-3f4b8a1c2d70";
export const drawId = (saleId: string, n: number) => uuidv5(`${saleId}:${n}`, DRAW_NAMESPACE);
