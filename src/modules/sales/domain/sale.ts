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
