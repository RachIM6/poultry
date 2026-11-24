import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { valuate } from "@/modules/inventory/domain/valuation";

export type BatchConsumption = Map<string, { quantity: bigint; centimes: bigint; byDay: Map<string, bigint> }>;

/**
 * S5, B6, for flock when a batch closes: what the batch's consumptions (feed, vaccine doses, medicine) cost at each
 * item's weighted average cost, from the whole ledger of the items it used.
 */
export async function batchConsumptionCost(tx: Tx, ctx: TenantContext, batchId: string): Promise<bigint> {
  const consumed = (await batchConsumptions(tx, ctx, [batchId])).get(batchId) ?? new Map();
  return [...consumed.values()].reduce((s, k) => s + k.centimes, 0n);
}

/**
 * For finance (SPEC-finance FN15): what each batch consumed, by item kind (feed, vaccine, …): the quantity in base units
 * (grams for kg) and its cost at each item's weighted average cost. `asOf` (FC4): the consumptions dated on or before
 * that day only; the running average makes their cost independent of later movements. `byDay`: that cost by farm day
 * (FN15's weekly cash need of a budget copied from the batch). One query whatever the number of batches: each item's
 * ledger is read and valued once. A batch with no consumption gets an empty map.
 */
export async function batchConsumptions(tx: Tx, ctx: TenantContext, batchIds: string[], asOf?: string): Promise<Map<string, BatchConsumption>> {
  // One read: the whole ledger of every item these batches used, with the item's kind and each purchase's amount.
  const ledger = await tx.$queryRaw<{ id: string; stockItemId: string; batchId: string | null; quantity: number; day: string; createdAt: Date; kind: string | null; paid: bigint | null }[]>`
    SELECT m.id, m."stockItemId", m."batchId", m.quantity, to_char(m.day, 'YYYY-MM-DD') AS day, m."createdAt", i.kind, p."amountCentimes" AS paid
    FROM "StockMovement" m
    LEFT JOIN "StockItem" i ON i.id = m."stockItemId" AND i."organizationId" = m."organizationId"
    LEFT JOIN "Purchase" p ON p.id = m."purchaseId"
    WHERE m."organizationId" = ${ctx.organizationId}::uuid
      AND m."stockItemId" IN (SELECT u."stockItemId" FROM "StockMovement" u WHERE u."organizationId" = ${ctx.organizationId}::uuid AND u."batchId" = ANY(${batchIds}::uuid[]))`;
  const mine = ledger.filter((m) => m.batchId !== null && batchIds.includes(m.batchId) && !(asOf && m.day > asOf));
  const costs = new Map<string, Map<string, bigint>>();
  const kindOf = new Map<string, string>();
  for (const item of new Set(mine.map((m) => m.stockItemId))) {
    const moves = ledger.filter((m) => m.stockItemId === item);
    costs.set(item, valuate(moves.map((m) => ({ id: m.id, day: m.day, quantity: m.quantity, createdAt: m.createdAt, purchaseAmountCentimes: m.paid ?? undefined }))).costs);
    kindOf.set(item, moves[0].kind ?? "other");
  }

  const result = new Map<string, BatchConsumption>(batchIds.map((id) => [id, new Map()]));
  for (const batchId of batchIds) {
    const ofBatch = mine.filter((m) => m.batchId === batchId);
    const byKind = result.get(batchId)!;
    for (const item of new Set(ofBatch.map((m) => m.stockItemId))) {
      const kind = kindOf.get(item)!;
      const k = byKind.get(kind) ?? { quantity: 0n, centimes: 0n, byDay: new Map<string, bigint>() };
      for (const m of ofBatch) {
        if (m.stockItemId !== item) continue;
        const cost = costs.get(item)!.get(m.id) ?? 0n;
        k.quantity += BigInt(-m.quantity); // a consumption is a negative movement
        k.centimes += cost;
        k.byDay.set(m.day, (k.byDay.get(m.day) ?? 0n) + cost);
      }
      byKind.set(kind, k);
    }
  }
  return result;
}
