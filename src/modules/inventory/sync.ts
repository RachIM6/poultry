import { can, withoutMoney } from "@/lib/permissions";
import { defineMutation, type SyncRegistry } from "@/lib/sync/server";
import { adjustStock, cancelPurchase, createStockItem, createSupplier, debitIssued, recordPurchase, recordSupplierPayment, setThreshold } from "@/modules/inventory/application/stock";
import {
  AdjustStock,
  CancelPurchase,
  CreateStockItem,
  CreateSupplier,
  DebitIssued,
  INVENTORY_MUTATIONS as M,
  PURCHASE_MONEY,
  RecordPurchase,
  RecordSupplierPayment,
  SetThreshold,
  type MovementDto,
  type PurchaseDto,
  type IssuedDebitDto,
  type StockItemDto,
  type SupplierDto,
  type SupplierPaymentDto,
} from "@/modules/inventory/schema";

// Offline stock writes (SPEC S1–S3). Owners and managers buy and correct stock; workers see quantities only (I5).
export const inventorySync: SyncRegistry = {
  mutations: {
    [M.createSupplier]: defineMutation({ schema: CreateSupplier, action: "stock.manage", apply: createSupplier }),
    [M.createStockItem]: defineMutation({ schema: CreateStockItem, action: "stock.manage", apply: createStockItem }),
    [M.recordPurchase]: defineMutation({ schema: RecordPurchase, action: "stock.manage", apply: recordPurchase }),
    [M.adjustStock]: defineMutation({ schema: AdjustStock, action: "stock.manage", apply: adjustStock }),
    [M.setThreshold]: defineMutation({ schema: SetThreshold, action: "stock.manage", apply: setThreshold }),
    [M.recordSupplierPayment]: defineMutation({ schema: RecordSupplierPayment, action: "stock.manage", apply: (tx, ctx, cmd, meta) => recordSupplierPayment(tx, ctx, cmd, meta) }),
    [M.debitIssued]: defineMutation({ schema: DebitIssued, action: "stock.manage", apply: (tx, ctx, cmd, meta) => debitIssued(tx, ctx, cmd, meta) }),
    [M.cancelPurchase]: defineMutation({ schema: CancelPurchase, action: "stock.manage", apply: (tx, ctx, cmd, meta) => cancelPurchase(tx, ctx, cmd, meta) }),
  },
  entities: {
    supplier: (_ctx, data: SupplierDto) => data,
    stockItem: (_ctx, data: StockItemDto) => data,
    movement: (_ctx, data: MovementDto) => data,
    purchase: (ctx, data: PurchaseDto) => withoutMoney(ctx, data, PURCHASE_MONEY), // prices, amounts, credit
    supplierPayment: (ctx, data: SupplierPaymentDto) => withoutMoney(ctx, data, ["amountCentimes", "method", "instrument"]),
    issuedDebit: (ctx, data: IssuedDebitDto) => (can(ctx, "money.read") ? data : undefined), // FN11: how suppliers were paid
  },
};
