import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmBelongsTo } from "@/modules/farm-registry";
import { checkAdjustment, checkItem, checkPurchase } from "@/modules/inventory/domain/stock";
import {
  findItem,
  idTaken,
  insertItem,
  insertMovement,
  insertPurchase,
  insertSupplier,
  supplierExists,
} from "@/modules/inventory/infrastructure/repository";
import type { AdjustStock, CreateStockItem, CreateSupplier, RecordPurchase } from "@/modules/inventory/schema";
import { isCatalogueProduct } from "@/modules/reference-data";

// Use cases, applied by POST /api/sync/push in one transaction each: load → domain rule → save + change log + audit.
// Rejections happen before any write (lib/sync/server.ts MutationHandler).

type Meta = { mutationId: string; deviceCreatedAt: Date };

export async function createSupplier(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof CreateSupplier>, meta: Meta) {
  if (await idTaken(tx, "supplier", cmd.id)) return fail("ALREADY_EXISTS");
  const supplier = await insertSupplier(tx, ctx, cmd);
  await recordChange(tx, ctx, "supplier", supplier.id, supplier);
  await audit(tx, ctx, { entity: "Supplier", entityId: supplier.id, action: "create", after: supplier, ...meta });
  return ok(undefined);
}

export async function createStockItem(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof CreateStockItem>, meta: Meta) {
  if (!(await farmBelongsTo(tx, ctx, cmd.farmId))) return fail("NOT_FOUND");
  if (cmd.productId && !(await isCatalogueProduct(tx, cmd.productId))) return fail("INVALID_INPUT");
  const rule = checkItem(cmd);
  if (!rule.ok) return rule;
  if (await idTaken(tx, "stockItem", cmd.id)) return fail("ALREADY_EXISTS");
  const item = await insertItem(tx, ctx, cmd);
  await recordChange(tx, ctx, "stockItem", item.id, item);
  await audit(tx, ctx, { entity: "StockItem", entityId: item.id, action: "create", after: item, ...meta });
  return ok(undefined);
}

/** S2–S3: the purchase and its "purchase" movement, together; the unpaid part is supplier credit. */
export async function recordPurchase(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof RecordPurchase>, meta: Meta) {
  const item = await findItem(tx, ctx, cmd.stockItemId);
  if (!item || !(await supplierExists(tx, ctx, cmd.supplierId))) return fail("NOT_FOUND");
  const [unitPriceCentimes, paidCentimes] = [BigInt(cmd.unitPriceCentimes), BigInt(cmd.paidCentimes)];
  const priced = checkPurchase({ quantity: cmd.quantity, unit: item.unit, unitPriceCentimes, paidCentimes, dueOn: cmd.dueOn });
  if (!priced.ok) return priced;
  if ((await idTaken(tx, "purchase", cmd.id)) || (await idTaken(tx, "stockMovement", cmd.movementId))) return fail("ALREADY_EXISTS");

  const base = { farmId: item.farmId, stockItemId: item.id, day: cmd.day, quantity: cmd.quantity };
  const purchase = await insertPurchase(tx, ctx, {
    id: cmd.id,
    supplierId: cmd.supplierId,
    ...base,
    unitPriceCentimes,
    amountCentimes: priced.value.amountCentimes,
    paidCentimes,
    dueOn: cmd.dueOn,
  });
  const movement = await insertMovement(tx, ctx, { id: cmd.movementId, ...base, kind: "purchase", reason: null, purchaseId: purchase.id });
  await recordChange(tx, ctx, "purchase", purchase.id, purchase);
  await recordChange(tx, ctx, "movement", movement.id, movement);
  await audit(tx, ctx, { entity: "Purchase", entityId: purchase.id, action: "create", after: purchase, ...meta });
  return ok(undefined);
}

/** S3: a correction is a new movement with its reason, never an edited quantity. */
export async function adjustStock(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof AdjustStock>, meta: Meta) {
  const item = await findItem(tx, ctx, cmd.stockItemId);
  if (!item) return fail("NOT_FOUND");
  const rule = checkAdjustment(cmd);
  if (!rule.ok) return rule;
  if (await idTaken(tx, "stockMovement", cmd.id)) return fail("ALREADY_EXISTS");
  const movement = await insertMovement(tx, ctx, {
    id: cmd.id,
    farmId: item.farmId,
    stockItemId: item.id,
    kind: "adjustment",
    quantity: cmd.quantity,
    day: cmd.day,
    reason: cmd.reason,
    purchaseId: null,
  });
  await recordChange(tx, ctx, "movement", movement.id, movement);
  await audit(tx, ctx, { entity: "StockMovement", entityId: movement.id, action: "create", after: movement, ...meta });
  return ok(undefined);
}
