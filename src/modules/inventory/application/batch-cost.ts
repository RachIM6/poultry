import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { valuate } from "@/modules/inventory/domain/valuation";

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * S5, B6, for flock when a batch closes: what the batch's consumptions (feed, vaccine doses, medicine) cost at each
 * item's weighted average cost, from the whole ledger of the items it used.
 */
export async function batchConsumptionCost(tx: Tx, ctx: TenantContext, batchId: string): Promise<bigint> {
  const org = ctx.organizationId;
  const mine = await tx.stockMovement.findMany({ where: { organizationId: org, batchId }, select: { id: true, stockItemId: true } });
  const items = [...new Set(mine.map((m) => m.stockItemId))];
  const ledger = await tx.stockMovement.findMany({ where: { organizationId: org, stockItemId: { in: items } } });
  const purchaseIds = ledger.flatMap((m) => (m.purchaseId ? [m.purchaseId] : []));
  const paid = new Map((await tx.purchase.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, amountCentimes: true } })).map((p) => [p.id, p.amountCentimes]));

  let total = 0n;
  for (const item of items) {
    const { costs } = valuate(
      ledger
        .filter((m) => m.stockItemId === item)
        .map((m) => ({ id: m.id, day: dayOf(m.day), quantity: m.quantity, purchaseAmountCentimes: m.purchaseId ? paid.get(m.purchaseId) : undefined })),
    );
    for (const m of mine) if (m.stockItemId === item) total += costs.get(m.id) ?? 0n;
  }
  return total;
}
