import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC S1–S3. Pure: the phone shows stock and balances with these, the server enforces them with the same code.

export const ITEM_KINDS = ["feed", "vaccine", "medicine", "litter", "gas", "other"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** The unit a person enters and reads. Quantities are stored as integers of the base unit: grams for kg (SPEC §5). */
export const UNITS = ["kg", "dose", "ml", "unit"] as const;
export type Unit = (typeof UNITS)[number];
const BASE: Record<Unit, number> = { kg: 1000, dose: 1, ml: 1, unit: 1 };

/** "1 250,5" kg → 1 250 500 g; "100" doses → 100. Null when not a positive amount the unit can hold. Digits only, no float. */
export function parseQuantity(text: string, unit: Unit): number | null {
  const decimals = Math.log10(BASE[unit]); // kg: up to 3 decimals (grams), others: whole numbers
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(text.replace(/[\s  ]/g, ""));
  if (!m || (m[2] ?? "").length > decimals) return null;
  const value = Number(m[1]) * BASE[unit] + Number((m[2] ?? "").padEnd(decimals, "0") || 0);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** S3: stock on hand is the sum of an item's movements, never a stored number. */
export function stockOnHand(movements: readonly { stockItemId: string; quantity: number }[]): Map<string, number> {
  const onHand = new Map<string, number>();
  for (const m of movements) onHand.set(m.stockItemId, (onHand.get(m.stockItemId) ?? 0) + m.quantity);
  return onHand;
}

/** S1: vaccines and medicines are tracked by lot, with an expiry date. */
export function checkItem(item: { kind: ItemKind; lot: string | null; expiresOn: string | null }): Result<void, "LOT_REQUIRED"> {
  return (item.kind === "vaccine" || item.kind === "medicine") && (!item.lot || !item.expiresOn) ? fail("LOT_REQUIRED") : ok(undefined);
}

/** Quantity (base units) × price per displayed unit, rounded half up to the centime, exactly. */
export function purchaseAmount(quantity: number, unit: Unit, unitPriceCentimes: bigint): bigint {
  const base = BigInt(BASE[unit]);
  return (BigInt(quantity) * unitPriceCentimes * 2n + base) / (2n * base);
}

type PurchaseError = "INVALID_QUANTITY" | "PAID_MORE_THAN_AMOUNT" | "DUE_DATE_WITHOUT_CREDIT";

/** S2: what is not paid now becomes supplier credit; a due date only makes sense for credit. */
export function checkPurchase(p: {
  quantity: number;
  unit: Unit;
  unitPriceCentimes: bigint;
  paidCentimes: bigint;
  dueOn: string | null;
}): Result<{ amountCentimes: bigint; creditCentimes: bigint }, PurchaseError> {
  if (!Number.isSafeInteger(p.quantity) || p.quantity <= 0) return fail("INVALID_QUANTITY");
  const amountCentimes = purchaseAmount(p.quantity, p.unit, p.unitPriceCentimes);
  if (p.paidCentimes > amountCentimes) return fail("PAID_MORE_THAN_AMOUNT");
  const creditCentimes = amountCentimes - p.paidCentimes;
  if (p.dueOn && creditCentimes === 0n) return fail("DUE_DATE_WITHOUT_CREDIT");
  return ok({ amountCentimes, creditCentimes });
}

/** S3: a correction is its own movement, with a reason; quantities are never edited in place. */
export function checkAdjustment(a: { quantity: number; reason: string }): Result<void, "INVALID_QUANTITY" | "REASON_REQUIRED"> {
  if (!Number.isSafeInteger(a.quantity) || a.quantity === 0) return fail("INVALID_QUANTITY");
  return a.reason.trim() ? ok(undefined) : fail("REASON_REQUIRED");
}

/** S2: balance owed to each supplier = purchases − what was paid. */
export function supplierBalances(purchases: readonly { supplierId: string; amountCentimes: bigint; paidCentimes: bigint }[]) {
  const balances = new Map<string, bigint>();
  for (const p of purchases) balances.set(p.supplierId, (balances.get(p.supplierId) ?? 0n) + p.amountCentimes - p.paidCentimes);
  return balances;
}

/**
 * S6: alert once, when a movement takes stock from at or above the item's threshold to below it. Further movements
 * while it stays below don't alert again; a restock above the threshold re-arms it.
 */
export const crossedBelow = (before: number, after: number, threshold: number | null) =>
  threshold !== null && before >= threshold && after < threshold;
