// Public API of the `flock` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./schema for what the offline client needs (ADR-008).
export { flockSync } from "./sync";
export { batchFacts, batchInHouseOn, batchPlaces } from "./infrastructure/batches";
// For modules that depend on flock but not on farm-registry (climate): the caller's house and its farm, or null.
export { farmBelongsTo, houseOf } from "@/modules/farm-registry";
export { recordBirdsSold } from "./application/sold-birds";
// SPEC-m5 PL3: planning places a batch from a plan inside its own mutation (same rules, same transaction).
export { placeBatch } from "./application/place-batch";
export { placementsChangedSince, type PlacementChange } from "./application/changes";
export { batchesForFinance, type BatchMoneyFacts } from "./application/finance-facts";
