import { withoutMoney } from "@/lib/permissions";
import { defineMutation, type SyncRegistry } from "@/lib/sync/server";
import { adjustStock, createStockItem, createSupplier, recordPurchase, setThreshold } from "@/modules/inventory/application/stock";
import {
  AdjustStock,
  CreateStockItem,
  CreateSupplier,
  INVENTORY_MUTATIONS as M,
  PURCHASE_MONEY,
  RecordPurchase,
  SetThreshold,
  type MovementDto,
  type PurchaseDto,
  type StockItemDto,
  type SupplierDto,
} from "@/modules/inventory/schema";

// Offline stock writes (SPEC S1–S3). Owners and managers buy and correct stock; workers see quantities only (I5).
export const inventorySync: SyncRegistry = {
  mutations: {
    [M.createSupplier]: defineMutation({ schema: CreateSupplier, action: "stock.manage", apply: createSupplier }),
    [M.createStockItem]: defineMutation({ schema: CreateStockItem, action: "stock.manage", apply: createStockItem }),
    [M.recordPurchase]: defineMutation({ schema: RecordPurchase, action: "stock.manage", apply: recordPurchase }),
    [M.adjustStock]: defineMutation({ schema: AdjustStock, action: "stock.manage", apply: adjustStock }),
    [M.setThreshold]: defineMutation({ schema: SetThreshold, action: "stock.manage", apply: setThreshold }),
  },
  entities: {
    supplier: (_ctx, data: SupplierDto) => data,
    stockItem: (_ctx, data: StockItemDto) => data,
    movement: (_ctx, data: MovementDto) => data,
    purchase: (ctx, data: PurchaseDto) => withoutMoney(ctx, data, PURCHASE_MONEY), // prices, amounts, credit
  },
};
