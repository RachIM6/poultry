import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC V4. Pure: the phone shows what each buyer owes and checks a payment with the same code as the server.

/** V4: what each buyer owes = what their sales left unpaid − what they paid later. */
export function buyerBalances(
  sales: readonly { buyerId: string; amountCentimes: bigint; paidCentimes: bigint }[],
  payments: readonly { buyerId: string; amountCentimes: bigint }[],
): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  const add = (buyerId: string, n: bigint) => balances.set(buyerId, (balances.get(buyerId) ?? 0n) + n);
  for (const s of sales) add(s.buyerId, s.amountCentimes - s.paidCentimes);
  for (const p of payments) add(p.buyerId, -p.amountCentimes);
  return balances;
}

/** V4: a later payment from a buyer, no more than they owe. */
export function checkPayment(amountCentimes: bigint, balanceCentimes: bigint): Result<void, "INVALID_QUANTITY" | "PAID_MORE_THAN_BALANCE"> {
  if (amountCentimes <= 0n) return fail("INVALID_QUANTITY");
  if (amountCentimes > balanceCentimes) return fail("PAID_MORE_THAN_BALANCE");
  return ok(undefined);
}

