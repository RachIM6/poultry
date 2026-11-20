import type { ItemKind, Unit } from "@/modules/inventory/domain/stock";

// What the phone's screens need from inventory, without Zod (ADR-009): stock and balances computed with the same domain
// rules as the server, the DTOs and the mutation names. The Zod schemas are in ./schema.ts, which re-exports this file.
export { ITEM_KINDS, UNITS, parseQuantity, purchaseAmount, stockOnHand } from "@/modules/inventory/domain/stock";
export { checkSupplierPayment, supplierBalances, supplierDues } from "@/modules/inventory/domain/suppliers";
export { valuate } from "@/modules/inventory/domain/valuation";
export type { ItemKind, Unit } from "@/modules/inventory/domain/stock";

/** What pull returns and the phone stores. */
export type SupplierDto = { id: string; name: string; phone: string | null };
export type StockItemDto = {
  id: string;
  farmId: string;
  productId: string | null;
  kind: ItemKind;
  name: string;
  unit: Unit;
  lot: string | null;
  expiresOn: string | null;
  lowStockThreshold: number | null;
};
export type MovementDto = {
  id: string;
  farmId: string;
  stockItemId: string;
  kind: "purchase" | "consumption" | "adjustment";
  quantity: number;
  day: string;
  reason: string | null;
  purchaseId: string | null;
};
export type PurchaseDto = {
  id: string;
  farmId: string;
  supplierId: string;
  stockItemId: string;
  day: string;
  quantity: number;
  // Money and credit (SPEC I5): absent for workers.
  unitPriceCentimes?: string;
  amountCentimes?: string;
  paidCentimes?: string;
  vatCentimes?: string; // SPEC-finance FN9: part of amountCentimes; absent from a purchase recorded before T39
  paidMethod?: (typeof SUPPLIER_PAYMENT_METHODS)[number]; // SPEC-finance FN6: how the part paid at once was paid; absent: cash
  dueOn?: string | null;
};
export const PURCHASE_MONEY = ["unitPriceCentimes", "amountCentimes", "paidCentimes", "vatCentimes", "paidMethod", "dueOn"] as const;

/** S2, SPEC-finance FN6: how a supplier is paid later. A cheque leaves the bank on its issue date; a bill is accepted. */
export const SUPPLIER_PAYMENT_METHODS = ["cash", "transfer", "cheque", "bill"] as const;
/** All money: owners and managers only (I5). */
export type SupplierPaymentDto = {
  id: string;
  supplierId: string;
  day: string;
  amountCentimes: string;
  method: (typeof SUPPLIER_PAYMENT_METHODS)[number];
  instrument?: { number: string | null; dueOn: string } | null; // FN11: an issued cheque's or bill's, when given
};
/** FN11: the bank debited an issued cheque or bill (its id: the purchase's or the later payment's). */
export type IssuedDebitDto = { id: string; instrumentId: string; day: string };
export { checkDebit, issuedOf, type Issued } from "@/modules/inventory/domain/issued";

export const INVENTORY_MUTATIONS = {
  createSupplier: "inventory.createSupplier",
  createStockItem: "inventory.createStockItem",
  recordPurchase: "inventory.recordPurchase",
  adjustStock: "inventory.adjustStock",
  setThreshold: "inventory.setThreshold",
  recordSupplierPayment: "inventory.recordSupplierPayment",
  debitIssued: "inventory.debitIssued",
} as const;
