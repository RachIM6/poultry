// Public API of the `inventory` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./schema for what the offline client needs (ADR-008).
export { inventorySync } from "./sync";
export { stockOnHand, supplierBalances } from "./domain/stock";
export { valuate } from "./domain/valuation";
export { recordConsumption, removeConsumption } from "./application/consumption";
export { batchConsumptionCost } from "./application/batch-cost";
