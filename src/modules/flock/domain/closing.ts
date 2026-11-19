// SPEC B6. Pure: the server locks these figures when the batch closes; the phone shows them with the same code.

/**
 * Cost per kg sold = (chicks + valued consumptions + other costs) ÷ kg sold at the farm's weight, in centimes per kg,
 * rounded half up. Every chick placed is paid for, dead on arrival included. Null before any kg is sold.
 */
export function batchCost(c: { chicksCentimes: bigint; consumedCentimes: bigint; otherCentimes: bigint; soldGrams: number }) {
  const totalCentimes = c.chicksCentimes + c.consumedCentimes + c.otherCentimes;
  const grams = BigInt(c.soldGrams);
  return { totalCentimes, perKgCentimes: grams > 0n ? (totalCentimes * 2000n + grams) / (2n * grams) : null };
}
