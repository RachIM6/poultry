import { withoutMoney } from "@/lib/permissions";
import { defineMutation, type SyncRegistry } from "@/lib/sync/server";
import { createBuyer, recordSale } from "@/modules/sales/application/sales";
import { CreateBuyer, RecordSale, SALE_MONEY, SALES_MUTATIONS as M, type BuyerDto, type SaleDto } from "@/modules/sales/schema";

// Offline sales writes: owners and managers only, since a sale carries prices and amounts (SPEC I5). Workers see the
// birds leave through flock's sold birds, never the sale's money.
export const salesSync: SyncRegistry = {
  mutations: {
    [M.createBuyer]: defineMutation({ schema: CreateBuyer, action: "sales.manage", apply: (tx, ctx, cmd, meta) => createBuyer(tx, ctx, cmd, meta) }),
    [M.recordSale]: defineMutation({ schema: RecordSale, action: "sales.manage", apply: (tx, ctx, cmd, meta) => recordSale(tx, ctx, cmd, meta) }),
  },
  entities: {
    buyer: (_ctx, data: BuyerDto) => data,
    sale: (ctx, data: SaleDto) => withoutMoney(ctx, data, SALE_MONEY),
  },
};
