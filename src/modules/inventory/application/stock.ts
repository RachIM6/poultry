import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, latestRecordableDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmBelongsTo } from "@/modules/farm-registry";
import { alertIfLow } from "@/modules/inventory/application/alerts";
import { checkAdjustment, checkItem, checkPurchase } from "@/modules/inventory/domain/stock";
import { checkSupplierPayment } from "@/modules/inventory/domain/suppliers";
import {
  deletePurchase,
  findItem,
  findPurchase,
  idTaken,
  insertItem,
  insertMovement,
  insertPurchase,
  insertSupplier,
  insertSupplierPayment,
  issuedDebited,
  issuedOfOrg,
  lockedSupplierBalance,
  onHandOf,
  supplierExists,
  updateThreshold,
} from "@/modules/inventory/infrastructure/repository";
import type { AdjustStock, CancelPurchase, CreateStockItem, CreateSupplier, DebitIssued, IssuedDebitDto, RecordPurchase, RecordSupplierPayment, SetThreshold, SupplierPaymentDto } from "@/modules/inventory/schema";
import { checkDebit } from "@/modules/inventory/domain/issued";
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
  const [unitPriceCentimes, paidCentimes, vatCentimes] = [BigInt(cmd.unitPriceCentimes), BigInt(cmd.paidCentimes), BigInt(cmd.vatCentimes)];
  const priced = checkPurchase({ quantity: cmd.quantity, unit: item.unit, unitPriceCentimes, paidCentimes, vatCentimes, dueOn: cmd.dueOn });
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
    vatCentimes,
    paidMethod: cmd.paidMethod,
    dueOn: cmd.dueOn,
  });
  const movement = await insertMovement(tx, ctx, { id: cmd.movementId, ...base, kind: "purchase", reason: null, purchaseId: purchase.id });
  await recordChange(tx, ctx, "purchase", purchase.id, purchase);
  await recordChange(tx, ctx, "movement", movement.id, movement);
  await audit(tx, ctx, { entity: "Purchase", entityId: purchase.id, action: "create", after: purchase, ...meta });
  return ok(undefined);
}

/**
 * SPEC-finance §9 "Cancelled records", applied by the sync push: a purchase typed wrong is cancelled (then typed again).
 * Its stock movement goes with it, so the stock and its value come back; finance reverses its entry (FN7). Refused while
 * the stock on hand is below what it brought in (some was used), once the bank debited the cheque or bill it was paid
 * with, or once later payments to the supplier cover it. Every check before the first write.
 */
export async function cancelPurchase(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof CancelPurchase>, meta: Meta) {
  const found = await findPurchase(tx, ctx, cmd.purchaseId);
  if (!found) return fail("NOT_FOUND");
  const { purchase, movements } = found;
  if (await issuedDebited(tx, ctx, purchase.id)) return fail("PURCHASE_HAS_PAYMENT");
  const credit = BigInt(purchase.amountCentimes) - BigInt(purchase.paidCentimes);
  if ((await lockedSupplierBalance(tx, ctx, purchase.supplierId)) < credit) return fail("PURCHASE_HAS_PAYMENT");
  const brought = movements.reduce((n, m) => n + m.quantity, 0);
  if ((await onHandOf(tx, ctx, purchase.stockItemId)) < brought) return fail("STOCK_ALREADY_USED");

  await deletePurchase(tx, ctx, purchase.id);
  for (const m of movements) await recordChange(tx, ctx, "movement", m.id, null);
  await recordChange(tx, ctx, "purchase", purchase.id, null);
  await audit(tx, ctx, { entity: "Purchase", entityId: purchase.id, action: "cancel", before: { ...purchase, movements }, ...meta });
  return ok(undefined);
}

/**
 * S2, SPEC-finance FN6, applied by the sync push: a later payment to a supplier, up to what is owed, under the
 * supplier's lock. Finance posts it from the change log (D 4411 / C cash, bank or bill payable).
 */
export async function recordSupplierPayment(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof RecordSupplierPayment>, meta: Meta, clock: Clock = systemClock) {
  if ((await tx.supplierPayment.count({ where: { id: cmd.id } })) > 0) return fail("ALREADY_EXISTS");
  if (!(await supplierExists(tx, ctx, cmd.supplierId))) return fail("NOT_FOUND");
  if (daysBetween(cmd.day as FarmDay, latestRecordableDay(clock)) < 0) return fail("DAY_IN_FUTURE");
  if (cmd.instrument && cmd.method !== "cheque" && cmd.method !== "bill") return fail("INVALID_INPUT"); // FN11: only those carry one
  const checked = checkSupplierPayment(BigInt(cmd.amountCentimes), await lockedSupplierBalance(tx, ctx, cmd.supplierId));
  if (!checked.ok) return checked;
  const payment: SupplierPaymentDto = cmd;
  await insertSupplierPayment(tx, ctx, payment);
  await recordChange(tx, ctx, "supplierPayment", payment.id, payment);
  await audit(tx, ctx, { entity: "SupplierPayment", entityId: payment.id, action: "create", after: payment, ...meta });
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
  await alertIfLow(tx, ctx, item, movement.quantity);
  return ok(undefined);
}

/** S6: the stock level under which owners and managers are alerted; null turns the alert off. */
export async function setThreshold(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof SetThreshold>, meta: Meta) {
  const item = await findItem(tx, ctx, cmd.stockItemId);
  if (!item) return fail("NOT_FOUND");
  const updated = await updateThreshold(tx, ctx, item.id, cmd.lowStockThreshold);
  await recordChange(tx, ctx, "stockItem", updated.id, updated);
  const [before, after] = [{ lowStockThreshold: item.lowStockThreshold }, { lowStockThreshold: updated.lowStockThreshold }];
  await audit(tx, ctx, { entity: "StockItem", entityId: item.id, action: "update", before, after, ...meta });
  return ok(undefined);
}

/**
 * SPEC-finance FN11, applied by the sync push: the bank debited a cheque or bill issued to a supplier, once. Finance
 * posts a bill's debit from the change log (D 4415 / C 5141); a cheque already left the bank on its issue day.
 */
export async function debitIssued(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof DebitIssued>, meta: Meta, clock: Clock = systemClock) {
  if ((await tx.issuedDebit.count({ where: { id: cmd.id } })) > 0) return fail("ALREADY_EXISTS");
  if (daysBetween(cmd.day as FarmDay, latestRecordableDay(clock)) < 0) return fail("DAY_IN_FUTURE");
  const [issued] = await issuedOfOrg(tx, ctx, [cmd.instrumentId]);
  const checked = checkDebit(issued, cmd.day);
  if (!checked.ok) return checked;
  const debit: IssuedDebitDto = cmd;
  // The unique instrumentId: a debit from another phone at the same time inserts nothing, and this one is refused.
  const { count } = await tx.issuedDebit.createMany({ data: [{ ...debit, organizationId: ctx.organizationId, day: new Date(`${debit.day}T00:00:00Z`), recordedBy: ctx.userId }], skipDuplicates: true });
  if (count === 0) return fail("INVALID_TRANSITION");
  await recordChange(tx, ctx, "issuedDebit", debit.id, debit);
  await audit(tx, ctx, { entity: "IssuedDebit", entityId: debit.id, action: "create", after: debit, ...meta });
  return ok(undefined);
}
