import type { Tx } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { alertIfLow } from "@/modules/inventory/application/alerts";
import { deleteMovement, findItem, findMovement, insertMovement, updateMovementQuantity } from "@/modules/inventory/infrastructure/repository";
import type { MovementDto } from "@/modules/inventory/schema";

/**
 * S4: what another module's record consumed (the feed of a daily entry, the doses of a vaccination), as exactly one
 * "consumption" movement with the record's id, `quantity` in the item's base unit. Saving again updates that movement:
 * the one place a movement changes, because the record it mirrors was edited (and that edit is audited by its owner).
 * `of` restricts the item to a kind and, when the item names a catalogue product, to that product. Runs inside the
 * caller's transaction; validates before writing.
 */
export async function recordConsumption(
  tx: Tx,
  ctx: TenantContext,
  c: { id: string; farmId: string; stockItemId: string; quantity: number; day: string; of?: { kind: string; productId: string } },
): Promise<Result<void, "NOT_FOUND" | "WRONG_STOCK_ITEM">> {
  const item = await findItem(tx, ctx, c.stockItemId);
  if (!item || item.farmId !== c.farmId) return fail("NOT_FOUND"); // the item must be in the batch's farm
  if (c.of && (item.kind !== c.of.kind || (item.productId !== null && item.productId !== c.of.productId))) return fail("WRONG_STOCK_ITEM");

  const previous = await findMovement(tx, ctx, c.id);
  if (previous && previous.stockItemId !== item.id) await removeConsumption(tx, ctx, c.id); // another item this time
  const same = previous && previous.stockItemId === item.id ? previous : null;

  const movement: MovementDto = {
    id: c.id,
    farmId: c.farmId,
    stockItemId: item.id,
    kind: "consumption",
    quantity: -c.quantity,
    day: c.day,
    reason: null,
    purchaseId: null,
  };
  if (same) await updateMovementQuantity(tx, c.id, movement.quantity, c.day);
  else await insertMovement(tx, ctx, movement);
  await recordChange(tx, ctx, "movement", movement.id, movement);
  await alertIfLow(tx, ctx, item, movement.quantity - (same?.quantity ?? 0)); // S6 on the change only
  return ok(undefined);
}

/** The record no longer consumes anything (feed cleared): its movement goes, and the phones drop it on pull. */
export async function removeConsumption(tx: Tx, ctx: TenantContext, id: string) {
  if (!(await findMovement(tx, ctx, id))) return;
  await deleteMovement(tx, id);
  await recordChange(tx, ctx, "movement", id, null);
}
