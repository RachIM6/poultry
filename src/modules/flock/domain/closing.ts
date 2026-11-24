import { divHalfUp } from "@/lib/kernel/money";
import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC B6. Pure: the server locks these figures when the batch closes; the phone shows them with the same code.

/** B6: what a placement's chicks cost before their VAT: every chick billed, dead on arrival included; the free ones are free. */
export const chicksCost = (chicksPlaced: number, unitPriceCentimes: bigint) => BigInt(chicksPlaced) * unitPriceCentimes;

/**
 * SPEC-finance §9 "Chicks paid on delivery": what was paid at delivery is above zero and at most the placement's total,
 * its chicks and their VAT (FN9). The phone checks it as the server.
 */
export function checkPaidOnDelivery(amountCentimes: bigint, chicksPlaced: number, unitPriceCentimes: bigint, vatCentimes: bigint): Result<void, "INVALID_INPUT" | "PAID_MORE_THAN_OWED"> {
  if (amountCentimes <= 0n) return fail("INVALID_INPUT");
  return amountCentimes > chicksCost(chicksPlaced, unitPriceCentimes) + vatCentimes ? fail("PAID_MORE_THAN_OWED") : ok(undefined);
}

/**
 * Cost per kg sold = (chicks + valued consumptions + other costs) ÷ kg sold at the farm's weight, in centimes per kg,
 * rounded half up. Every chick placed is paid for, dead on arrival included. Null before any kg is sold.
 */
export function batchCost(c: { chicksCentimes: bigint; consumedCentimes: bigint; otherCentimes: bigint; soldGrams: number }) {
  const totalCentimes = c.chicksCentimes + c.consumedCentimes + c.otherCentimes;
  const grams = BigInt(c.soldGrams);
  return { totalCentimes, perKgCentimes: grams > 0n ? divHalfUp(totalCentimes * 1000n, grams) : null };
}
