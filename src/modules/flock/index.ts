// Public API of the `flock` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./schema for what the offline client needs (ADR-008).
export { flockSync } from "./sync";
export { batchFacts, batchPlacedInHouseOn } from "./infrastructure/batches";
// For modules that depend on flock but not on farm-registry (climate): the caller's house and its farm, or null.
export { farmBelongsTo, houseOf } from "@/modules/farm-registry";
export { recordBirdsSold } from "./application/sold-birds";
export { placementsChangedSince, type PlacementChange } from "./application/changes";
export { batchesForFinance, type BatchMoneyFacts } from "./application/finance-facts";
