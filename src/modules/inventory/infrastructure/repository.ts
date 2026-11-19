import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { ItemKind, Unit } from "@/modules/inventory/domain/stock";
import type { MovementDto, PurchaseDto, StockItemDto, SupplierDto } from "@/modules/inventory/schema";

// Prisma side of inventory. Every lookup is scoped to the caller's organisation: another organisation's id is not found.

const date = (day: string) => new Date(`${day}T00:00:00Z`); // a farm day, stored as a calendar date
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export const findItem = async (tx: Tx, ctx: TenantContext, id: string): Promise<StockItemDto | null> => {
  const row = await tx.stockItem.findFirst({ where: { id, organizationId: ctx.organizationId } });
  return row && itemDto(row);
};
export const supplierExists = async (tx: Tx, ctx: TenantContext, id: string) =>
  (await tx.supplier.count({ where: { id, organizationId: ctx.organizationId } })) === 1;

/** A device id already taken, in any organisation: the record can't be created again. */
export const idTaken = async (tx: Tx, table: "supplier" | "stockItem" | "stockMovement" | "purchase", id: string) => {
  const where = { where: { id } };
  const count =
    table === "supplier" ? await tx.supplier.count(where)
    : table === "stockItem" ? await tx.stockItem.count(where)
    : table === "stockMovement" ? await tx.stockMovement.count(where)
    : await tx.purchase.count(where);
  return count > 0;
};

/** S3: stock on hand from the ledger, as this transaction sees it. */
export const onHandOf = async (tx: Tx, ctx: TenantContext, stockItemId: string) =>
  (await tx.stockMovement.aggregate({ where: { stockItemId, organizationId: ctx.organizationId }, _sum: { quantity: true } }))._sum.quantity ?? 0;

export async function updateThreshold(tx: Tx, ctx: TenantContext, stockItemId: string, lowStockThreshold: number | null) {
  return itemDto(await tx.stockItem.update({ where: { id: stockItemId, organizationId: ctx.organizationId }, data: { lowStockThreshold } }));
}

export async function insertSupplier(tx: Tx, ctx: TenantContext, s: SupplierDto): Promise<SupplierDto> {
  const row = await tx.supplier.create({ data: { ...s, organizationId: ctx.organizationId } });
  return { id: row.id, name: row.name, phone: row.phone };
}

export async function insertItem(tx: Tx, ctx: TenantContext, i: StockItemDto): Promise<StockItemDto> {
  return itemDto(
    await tx.stockItem.create({ data: { ...i, organizationId: ctx.organizationId, expiresOn: i.expiresOn ? date(i.expiresOn) : null } }),
  );
}

export async function insertMovement(tx: Tx, ctx: TenantContext, m: MovementDto): Promise<MovementDto> {
  const row = await tx.stockMovement.create({ data: { ...m, organizationId: ctx.organizationId, day: date(m.day) } });
  return { ...m, day: dayOf(row.day) };
}

export async function insertPurchase(
  tx: Tx,
  ctx: TenantContext,
  p: Omit<PurchaseDto, "unitPriceCentimes" | "amountCentimes" | "paidCentimes" | "dueOn"> & {
    unitPriceCentimes: bigint;
    amountCentimes: bigint;
    paidCentimes: bigint;
    dueOn: string | null;
  },
): Promise<Required<PurchaseDto>> {
  await tx.purchase.create({
    data: { ...p, organizationId: ctx.organizationId, day: date(p.day), dueOn: p.dueOn ? date(p.dueOn) : null },
  });
  return { ...p, unitPriceCentimes: String(p.unitPriceCentimes), amountCentimes: String(p.amountCentimes), paidCentimes: String(p.paidCentimes) };
}

function itemDto(r: {
  id: string;
  farmId: string;
  productId: string | null;
  kind: string;
  name: string;
  unit: string;
  lot: string | null;
  expiresOn: Date | null;
  lowStockThreshold: number | null;
}): StockItemDto {
  return {
    id: r.id,
    farmId: r.farmId,
    productId: r.productId,
    kind: r.kind as ItemKind,
    name: r.name,
    unit: r.unit as Unit,
    lot: r.lot,
    expiresOn: r.expiresOn ? dayOf(r.expiresOn) : null,
    lowStockThreshold: r.lowStockThreshold,
  };
}
