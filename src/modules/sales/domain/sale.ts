import type { FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC V1–V3. Pure: the phone shows the amount and the gap, and refuses a sale during a withdrawal, with the same code
// as the server. Weights in grams, money in centimes (bigint).

export const BUYER_TYPES = ["trader", "abattoir", "market", "other"] as const;
export const PAYMENT_METHODS = ["cash", "cheque", "bill", "transfer", "credit"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** V2: amount = farm weight × price per kg, rounded half up to the centime, exactly. */
export const saleAmount = (weightGrams: number, pricePerKgCentimes: bigint) => (BigInt(weightGrams) * pricePerKgCentimes * 2n + 1000n) / 2000n;

/** V2: weighing gap = farm weight − buyer weight, in grams and as a % of the farm weight. Null without a buyer weight. */
export function weighingGap(farmWeightGrams: number, buyerWeightGrams: number | null) {
  if (buyerWeightGrams === null) return null;
  const grams = farmWeightGrams - buyerWeightGrams;
  return { grams, percent: (grams / farmWeightGrams) * 100 };
}

/** A cheque or a bill of exchange is a number and a due date (V2). */
const needsInstrument = (m: PaymentMethod) => m === "cheque" || m === "bill";

export type SaleError = "WITHDRAWAL_IN_PROGRESS" | "INVALID_QUANTITY" | "PAID_MORE_THAN_AMOUNT" | "INSTRUMENT_REQUIRED" | "INVALID_INPUT";

/**
 * V2, V3: may this sale be recorded? `withdrawalUntil` is the batch's withdrawal on the sale day (health's rule), null
 * when none runs: then no sale at all, no override in v1. Returns the amount.
 */
export function checkSale(
  s: {
    birds: number;
    farmWeightGrams: number;
    buyerWeightGrams: number | null;
    pricePerKgCentimes: bigint;
    paymentMethod: PaymentMethod;
    paidCentimes: bigint;
    instrument: { number: string; dueOn: string } | null;
  },
  withdrawalUntil: FarmDay | null,
): Result<{ amountCentimes: bigint }, SaleError> {
  if (withdrawalUntil) return fail("WITHDRAWAL_IN_PROGRESS");
  const weights = [s.birds, s.farmWeightGrams, s.buyerWeightGrams ?? 1];
  if (weights.some((n) => !Number.isSafeInteger(n) || n <= 0) || s.pricePerKgCentimes <= 0n || s.paidCentimes < 0n) return fail("INVALID_QUANTITY");
  const amountCentimes = saleAmount(s.farmWeightGrams, s.pricePerKgCentimes);
  if (s.paidCentimes > amountCentimes) return fail("PAID_MORE_THAN_AMOUNT");
  if (needsInstrument(s.paymentMethod) && !s.instrument) return fail("INSTRUMENT_REQUIRED");
  if (!needsInstrument(s.paymentMethod) && s.instrument) return fail("INVALID_INPUT");
  return ok({ amountCentimes });
}

/** SPEC-m3 V6: one line of an egg sale: eggs of one item, priced per tray of `eggsPerTray` (30 by default, MQ8). */
export type EggLine = { item: string; eggs: number; eggsPerTray: number; unitPriceCentimes: bigint };

/** V6: a line's amount = eggs × price per tray ÷ eggs per tray, rounded half up to the centime. */
export const eggLineAmount = (l: Pick<EggLine, "eggs" | "eggsPerTray" | "unitPriceCentimes">) =>
  (BigInt(l.eggs) * l.unitPriceCentimes * 2n + BigInt(l.eggsPerTray)) / (2n * BigInt(l.eggsPerTray));

/** V6: may this egg sale be recorded? The amount is the sum of its lines; payment rules as V2. Returns the amount. */
export function checkEggSale(s: {
  lines: readonly EggLine[];
  paymentMethod: PaymentMethod;
  paidCentimes: bigint;
  instrument: { number: string; dueOn: string } | null;
}): Result<{ amountCentimes: bigint }, SaleError> {
  if (s.lines.length === 0 || s.paidCentimes < 0n) return fail("INVALID_QUANTITY");
  if (s.lines.some((l) => !Number.isSafeInteger(l.eggs) || l.eggs <= 0 || !Number.isSafeInteger(l.eggsPerTray) || l.eggsPerTray <= 0 || l.unitPriceCentimes <= 0n)) {
    return fail("INVALID_QUANTITY");
  }
  const amountCentimes = s.lines.reduce((a, l) => a + eggLineAmount(l), 0n);
  if (s.paidCentimes > amountCentimes) return fail("PAID_MORE_THAN_AMOUNT");
  if (needsInstrument(s.paymentMethod) && !s.instrument) return fail("INSTRUMENT_REQUIRED");
  if (!needsInstrument(s.paymentMethod) && s.instrument) return fail("INVALID_INPUT");
  return ok({ amountCentimes });
}

/** SPEC-m3 V7: what a per-head line sells (P-Beldi: roosters and hens; quail, ducks, old hens: birds). */
export const HEAD_KINDS = ["rooster", "hen", "bird"] as const;
export type HeadLine = { item: (typeof HEAD_KINDS)[number]; birds: number; pricePerHeadCentimes: bigint };

/**
 * V7: may this per-head sale be recorded? Blocked during a withdrawal like V3; amount = Σ birds × price per head; the farm
 * weight is optional. Returns the amount and the birds sold.
 */
export function checkHeadSale(
  s: {
    lines: readonly HeadLine[];
    farmWeightGrams: number | null;
    paymentMethod: PaymentMethod;
    paidCentimes: bigint;
    instrument: { number: string; dueOn: string } | null;
  },
  withdrawalUntil: FarmDay | null,
): Result<{ amountCentimes: bigint; birds: number }, SaleError> {
  if (withdrawalUntil) return fail("WITHDRAWAL_IN_PROGRESS");
  if (s.lines.length === 0 || s.paidCentimes < 0n || (s.farmWeightGrams !== null && (!Number.isSafeInteger(s.farmWeightGrams) || s.farmWeightGrams <= 0))) return fail("INVALID_QUANTITY");
  if (s.lines.some((l) => !Number.isSafeInteger(l.birds) || l.birds <= 0 || l.pricePerHeadCentimes <= 0n)) return fail("INVALID_QUANTITY");
  const amountCentimes = s.lines.reduce((a, l) => a + BigInt(l.birds) * l.pricePerHeadCentimes, 0n);
  if (s.paidCentimes > amountCentimes) return fail("PAID_MORE_THAN_AMOUNT");
  if (needsInstrument(s.paymentMethod) && !s.instrument) return fail("INSTRUMENT_REQUIRED");
  if (!needsInstrument(s.paymentMethod) && s.instrument) return fail("INVALID_INPUT");
  return ok({ amountCentimes, birds: s.lines.reduce((n, l) => n + l.birds, 0) });
}
