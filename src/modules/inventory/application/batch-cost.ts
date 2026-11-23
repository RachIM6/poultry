import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { valuate } from "@/modules/inventory/domain/valuation";

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * S5, B6, for flock when a batch closes: what the batch's consumptions (feed, vaccine doses, medicine) cost at each
 * item's weighted average cost, from the whole ledger of the items it used.
 */
export async function batchConsumptionCost(tx: Tx, ctx: TenantContext, batchId: string): Promise<bigint> {
  return [...(await batchConsumption(tx, ctx, batchId)).values()].reduce((s, k) => s + k.centimes, 0n);
}

/**
 * For finance (SPEC-finance FN15): what the batch consumed, by item kind (feed, vaccine, …): the quantity in base units
 * (grams for kg) and its cost at each item's weighted average cost. `asOf` (FC4): the consumptions dated on or before
 * that day only; the running average makes their cost independent of later movements.
 */
export async function batchConsumption(tx: Tx, ctx: TenantContext, batchId: string, asOf?: string): Promise<Map<string, { quantity: bigint; centimes: bigint }>> {
  const org = ctx.organizationId;
  const mine = await tx.stockMovement.findMany({ where: { organizationId: org, batchId, ...(asOf && { day: { lte: new Date(`${asOf}T00:00:00Z`) } }) }, select: { id: true, stockItemId: true, quantity: true } });
  const items = [...new Set(mine.map((m) => m.stockItemId))];
  const [ledger, kinds] = await Promise.all([
    tx.stockMovement.findMany({ where: { organizationId: org, stockItemId: { in: items } } }),
    tx.stockItem.findMany({ where: { organizationId: org, id: { in: items } }, select: { id: true, kind: true } }),
  ]);
  const kindOf = new Map(kinds.map((k) => [k.id, k.kind]));
  const purchaseIds = ledger.flatMap((m) => (m.purchaseId ? [m.purchaseId] : []));
  const paid = new Map((await tx.purchase.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, amountCentimes: true } })).map((p) => [p.id, p.amountCentimes]));

  const byKind = new Map<string, { quantity: bigint; centimes: bigint }>();
  for (const item of items) {
    const { costs } = valuate(
      ledger
        .filter((m) => m.stockItemId === item)
        .map((m) => ({ id: m.id, day: dayOf(m.day), quantity: m.quantity, createdAt: m.createdAt, purchaseAmountCentimes: m.purchaseId ? paid.get(m.purchaseId) : undefined })),
    );
    const kind = kindOf.get(item) ?? "other";
    const k = byKind.get(kind) ?? { quantity: 0n, centimes: 0n };
    for (const m of mine) {
      if (m.stockItemId !== item) continue;
      k.quantity += BigInt(-m.quantity); // a consumption is a negative movement
      k.centimes += costs.get(m.id) ?? 0n;
    }
    byKind.set(kind, k);
  }
  return byKind;
}
