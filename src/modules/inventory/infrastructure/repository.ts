import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { ItemKind, Unit } from "@/modules/inventory/domain/stock";
import { issuedOf } from "@/modules/inventory/domain/issued";
import { supplierBalances } from "@/modules/inventory/domain/suppliers";
import type { MovementDto, PurchaseDto, StockItemDto, SupplierDto, SupplierPaymentDto } from "@/modules/inventory/schema";

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

/** S2: what is owed to a supplier, read under its row lock so two payments can't both pass the check. */
export async function lockedSupplierBalance(tx: Tx, ctx: TenantContext, supplierId: string) {
  await tx.$executeRaw`SELECT 1 FROM "Supplier" WHERE id = ${supplierId}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
  const where = { organizationId: ctx.organizationId, supplierId };
  const [bought, paid] = await Promise.all([
    tx.purchase.aggregate({ where, _sum: { amountCentimes: true, paidCentimes: true } }),
    tx.supplierPayment.aggregate({ where, _sum: { amountCentimes: true } }),
  ]);
  const purchases = [{ supplierId, amountCentimes: bought._sum.amountCentimes ?? 0n, paidCentimes: bought._sum.paidCentimes ?? 0n }];
  return supplierBalances(purchases, [{ supplierId, amountCentimes: paid._sum.amountCentimes ?? 0n }]).get(supplierId) ?? 0n;
}

export const insertSupplierPayment = (tx: Tx, ctx: TenantContext, { instrument, ...p }: SupplierPaymentDto) =>
  tx.supplierPayment.create({
    data: {
      ...p,
      organizationId: ctx.organizationId,
      day: date(p.day),
      amountCentimes: BigInt(p.amountCentimes),
      instrumentNumber: instrument?.number ?? null,
      instrumentDueOn: instrument ? date(instrument.dueOn) : null,
      recordedBy: ctx.userId,
    },
  });

/** FN11: this organisation's cheques and bills issued to suppliers (or the ones with these ids), with their debits. */
export async function issuedOfOrg(tx: Tx, ctx: TenantContext, ids?: string[]) {
  const where = { organizationId: ctx.organizationId, ...(ids && { id: { in: ids } }) };
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const [purchases, payments, debits] = await Promise.all([
    tx.purchase.findMany({ where: { ...where, paidMethod: { in: ["cheque", "bill"] }, paidCentimes: { gt: 0 } }, select: { id: true, supplierId: true, day: true, paidCentimes: true, paidMethod: true } }),
    tx.supplierPayment.findMany({ where: { ...where, method: { in: ["cheque", "bill"] } } }),
    tx.issuedDebit.findMany({ where: { organizationId: ctx.organizationId, ...(ids && { instrumentId: { in: ids } }) }, select: { instrumentId: true, day: true } }),
  ]);
  return issuedOf(
    purchases.map((p) => ({ ...p, day: day(p.day) })),
    payments.map((p) => ({ ...p, day: day(p.day), instrument: p.instrumentDueOn ? { number: p.instrumentNumber, dueOn: day(p.instrumentDueOn) } : null })),
    debits.map((d) => ({ ...d, day: day(d.day) })),
  );
}

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

export async function insertMovement(tx: Tx, ctx: TenantContext, m: MovementDto, batchId?: string): Promise<MovementDto> {
  const row = await tx.stockMovement.create({ data: { ...m, organizationId: ctx.organizationId, day: date(m.day), batchId } });
  return { ...m, day: dayOf(row.day) };
}

export async function findMovement(tx: Tx, ctx: TenantContext, id: string): Promise<MovementDto | null> {
  const row = await tx.stockMovement.findFirst({ where: { id, organizationId: ctx.organizationId } });
  return row && { ...row, kind: row.kind as MovementDto["kind"], day: dayOf(row.day) };
}

export const updateMovementQuantity = (tx: Tx, ctx: TenantContext, id: string, quantity: number, day: string) =>
  tx.stockMovement.update({ where: { id, organizationId: ctx.organizationId }, data: { quantity, day: date(day) } });

export const deleteMovement = (tx: Tx, ctx: TenantContext, id: string) => tx.stockMovement.delete({ where: { id, organizationId: ctx.organizationId } });

export async function insertPurchase(
  tx: Tx,
  ctx: TenantContext,
  p: Omit<PurchaseDto, "unitPriceCentimes" | "amountCentimes" | "paidCentimes" | "vatCentimes" | "paidMethod" | "dueOn"> & {
    unitPriceCentimes: bigint;
    amountCentimes: bigint;
    paidCentimes: bigint;
    vatCentimes: bigint;
    paidMethod: NonNullable<PurchaseDto["paidMethod"]>;
    dueOn: string | null;
  },
): Promise<Required<PurchaseDto>> {
  await tx.purchase.create({
    data: { ...p, organizationId: ctx.organizationId, day: date(p.day), dueOn: p.dueOn ? date(p.dueOn) : null },
  });
  return { ...p, unitPriceCentimes: String(p.unitPriceCentimes), amountCentimes: String(p.amountCentimes), paidCentimes: String(p.paidCentimes), vatCentimes: String(p.vatCentimes) };
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

export type IssuedDueRow = { organizationId: string; method: string; number: string | null; amountCentimes: bigint; supplier: string };

/**
 * FN11, for the reminder job, across organisations: marks the cheques and bills issued to suppliers whose agreed date
 * is `day`, not yet announced nor debited, and returns them with their supplier. A second job waits on the row lock.
 */
export const claimDueIssued = (tx: Tx, day: string, now: Date) => tx.$queryRaw<IssuedDueRow[]>`
  UPDATE "SupplierPayment" p SET "instrumentRemindedAt" = ${now}
  FROM "Supplier" s
  WHERE s.id = p."supplierId" AND p."instrumentDueOn" = ${day}::date AND p."instrumentRemindedAt" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "IssuedDebit" d WHERE d."instrumentId" = p.id)
  RETURNING p."organizationId", p.method, p."instrumentNumber" AS number, p."amountCentimes", s.name AS supplier`;
