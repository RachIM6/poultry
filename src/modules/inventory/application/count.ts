import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { ItemKind, Unit } from "@/modules/inventory/domain/stock";
import { valuate } from "@/modules/inventory/domain/valuation";

/**
 * For finance (SPEC-finance FC3), read-only: the organisation's stock items with stock in the books at the end of `day`
 * (a farm day), with lot, expiry and that book quantity in base units (S3: the sum of the movements up to that day).
 */
export async function stockOnDay(tx: Tx, ctx: TenantContext, day: string) {
  const org = ctx.organizationId;
  const sums = await tx.stockMovement.groupBy({ by: ["stockItemId"], where: { organizationId: org, day: { lte: new Date(`${day}T00:00:00Z`) } }, _sum: { quantity: true } });
  const onHand = new Map(sums.filter((s) => s._sum.quantity).map((s) => [s.stockItemId, s._sum.quantity!]));
  const items = await tx.stockItem.findMany({ where: { organizationId: org, id: { in: [...onHand.keys()] } }, orderBy: [{ kind: "asc" }, { name: "asc" }, { expiresOn: "asc" }] });
  return items.map((i) => ({
    id: i.id,
    farmId: i.farmId,
    kind: i.kind as ItemKind,
    name: i.name,
    unit: i.unit as Unit,
    lot: i.lot,
    expiresOn: i.expiresOn?.toISOString().slice(0, 10) ?? null,
    onHand: onHand.get(i.id)!,
  }));
}

/**
 * For finance (SPEC-finance FC5), read-only: each stock item's value at the weighted average cost (S5, `valuate`) at
 * the end of `day`, from its movements up to that day only. `netOfVat`: purchases enter without their VAT, as a
 * VAT-registered entity books them (FN9).
 */
export async function stockValueOnDay(tx: Tx, ctx: TenantContext, day: string, netOfVat: boolean): Promise<Map<string, bigint>> {
  const org = ctx.organizationId;
  const ledger = await tx.stockMovement.findMany({ where: { organizationId: org, day: { lte: new Date(`${day}T00:00:00Z`) } } });
  const purchaseIds = ledger.flatMap((m) => (m.purchaseId ? [m.purchaseId] : []));
  const purchases = await tx.purchase.findMany({ where: { organizationId: org, id: { in: purchaseIds } }, select: { id: true, amountCentimes: true, vatCentimes: true } });
  const paid = new Map(purchases.map((p) => [p.id, netOfVat ? p.amountCentimes - p.vatCentimes : p.amountCentimes]));
  const byItem = Map.groupBy(ledger, (m) => m.stockItemId);
  return new Map(
    [...byItem].map(([item, ms]) => [
      item,
      valuate(ms.map((m) => ({ id: m.id, day: m.day.toISOString().slice(0, 10), quantity: m.quantity, purchaseAmountCentimes: m.purchaseId ? paid.get(m.purchaseId) : undefined }))).valueCentimes,
    ]),
  );
}
