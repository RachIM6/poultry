import { db, type Tx } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { supplierDues } from "@/modules/inventory/domain/stock";
import type { PurchaseDto, SupplierPaymentDto } from "@/modules/inventory/shared";

export type PurchaseChange = { version: bigint; id: string; farmId: string; day: FarmDay; itemKind: string; amountCentimes: bigint; paidCentimes: bigint; vatCentimes: bigint };

/**
 * For finance (SPEC-finance FN7): purchases recorded or changed after `after` (this organisation's change-log
 * version), oldest first, with the kind of item bought (it picks the charge account).
 */
export async function purchasesChangedSince(tx: Tx, ctx: TenantContext, after: bigint, limit = 500): Promise<PurchaseChange[]> {
  const changes = await tx.change.findMany({
    where: { organizationId: ctx.organizationId, entity: "purchase", version: { gt: after } },
    orderBy: { version: "asc" },
    take: limit,
  });
  const purchases = changes.filter((c) => c.data !== null).map((c) => ({ version: c.version, p: c.data as unknown as PurchaseDto & Required<Omit<PurchaseDto, "vatCentimes">> }));
  const items = await tx.stockItem.findMany({ where: { organizationId: ctx.organizationId, id: { in: purchases.map((x) => x.p.stockItemId) } } });
  const kindOf = new Map(items.map((i) => [i.id, i.kind]));
  return purchases.map(({ version, p }) => ({
    version,
    id: p.id,
    farmId: p.farmId,
    day: p.day as FarmDay,
    itemKind: kindOf.get(p.stockItemId) ?? "other",
    amountCentimes: BigInt(p.amountCentimes),
    paidCentimes: BigInt(p.paidCentimes),
    vatCentimes: BigInt(p.vatCentimes ?? 0), // absent before T39
  }));
}

/** For finance (SPEC-finance FN6, FN7): later supplier payments recorded after `after`, oldest first. */
export async function supplierPaymentsChangedSince(tx: Tx, ctx: TenantContext, after: bigint, limit = 500) {
  const changes = await tx.change.findMany({
    where: { organizationId: ctx.organizationId, entity: "supplierPayment", version: { gt: after } },
    orderBy: { version: "asc" },
    take: limit,
  });
  return changes.filter((c) => c.data !== null).map((c) => ({ version: c.version, ...(c.data as unknown as SupplierPaymentDto) }));
}

/** For finance's cash schedule (FN12, F-Effects): what is still due to the suppliers, by due date. */
export async function supplierDuesOf(ctx: TenantContext): Promise<{ dueOn: string; amountCentimes: bigint }[]> {
  const where = { organizationId: ctx.organizationId };
  const [purchases, payments] = await Promise.all([
    db.purchase.findMany({ where, select: { supplierId: true, day: true, dueOn: true, amountCentimes: true, paidCentimes: true } }),
    db.supplierPayment.groupBy({ by: ["supplierId"], where, _sum: { amountCentimes: true } }),
  ]);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const paid = new Map(payments.map((p) => [p.supplierId, p._sum.amountCentimes ?? 0n]));
  const bySupplier = Map.groupBy(purchases, (p) => p.supplierId);
  return [...bySupplier].flatMap(([supplierId, ps]) =>
    supplierDues(ps.map((p) => ({ day: day(p.day), dueOn: p.dueOn && day(p.dueOn), amountCentimes: p.amountCentimes, paidCentimes: p.paidCentimes })), paid.get(supplierId) ?? 0n),
  );
}
