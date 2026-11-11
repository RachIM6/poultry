import type { ItemKind, Unit } from "@/modules/inventory/domain/stock";

// What the phone's screens need from inventory, without Zod (ADR-009): stock and balances computed with the same domain
// rules as the server, the DTOs and the mutation names. The Zod schemas are in ./schema.ts, which re-exports this file.
export { ITEM_KINDS, UNITS, parseQuantity, purchaseAmount, stockOnHand, supplierBalances } from "@/modules/inventory/domain/stock";
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
  dueOn?: string | null;
};
export const PURCHASE_MONEY = ["unitPriceCentimes", "amountCentimes", "paidCentimes", "dueOn"] as const;

export const INVENTORY_MUTATIONS = {
  createSupplier: "inventory.createSupplier",
  createStockItem: "inventory.createStockItem",
  recordPurchase: "inventory.recordPurchase",
  adjustStock: "inventory.adjustStock",
  setThreshold: "inventory.setThreshold",
} as const;
