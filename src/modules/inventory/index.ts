// Public API of the `inventory` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./schema for what the offline client needs (ADR-008).
export { inventorySync } from "./sync";
export { stockOnHand } from "./domain/stock";
export { supplierBalances } from "./domain/suppliers";
export { valuate } from "./domain/valuation";
export { recordConsumption, removeConsumption } from "./application/consumption";
export { batchConsumption, batchConsumptionCost } from "./application/batch-cost";
export { issuedBillsDue, issuedDebitsChangedSince, ledgerTagsOf, purchasesChangedSince, supplierDuesOf, supplierPaymentsChangedSince, type PurchaseChange } from "./application/changes";
