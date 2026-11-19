import type { Tx } from "@/lib/db";
import { formatCount, formatKgValue } from "@/lib/format";
import type { TenantContext } from "@/lib/tenant";
import { crossedBelow, type Unit } from "@/modules/inventory/domain/stock";
import { onHandOf } from "@/modules/inventory/infrastructure/repository";
import type { StockItemDto } from "@/modules/inventory/schema";
import { notify } from "@/modules/notifications";

const amount = (quantity: number, unit: Unit) => (unit === "kg" ? formatKgValue(quantity) : formatCount(quantity));

/**
 * S6, after a movement of `delta` was saved and its change recorded. Recording took the organisation's sync lock, so a
 * concurrent movement on the same item has committed before this reads the ledger: only one of them sees the crossing.
 * Every later outgoing movement (consumption in T16, vaccine use in T19) goes through here.
 */
export async function alertIfLow(tx: Tx, ctx: TenantContext, item: StockItemDto, delta: number) {
  const after = await onHandOf(tx, ctx, item.id);
  if (!crossedBelow(after - delta, after, item.lowStockThreshold)) return;
  await notify(tx, ctx, {
    roles: ["owner", "manager"], // who buys stock (stock.manage)
    templateKey: "lowStock",
    params: { item: item.name, quantity: amount(Math.max(after, 0), item.unit), unit: item.unit, threshold: amount(item.lowStockThreshold!, item.unit) },
    urgency: "normal",
  });
}
