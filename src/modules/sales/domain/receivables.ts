import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC V4. Pure: the phone shows what each buyer owes and checks a payment with the same code as the server.

/**
 * V4: what each buyer owes = what their sales left unpaid − what they paid later + the cheques and bills that came
 * back unpaid (SPEC-finance FN11: the claim is theirs again).
 */
export function buyerBalances(
  sales: readonly { buyerId: string; amountCentimes: bigint; paidCentimes: bigint }[],
  payments: readonly { buyerId: string; amountCentimes: bigint }[],
  unpaid: readonly { buyerId: string; amountCentimes: bigint }[] = [],
): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  const add = (buyerId: string, n: bigint) => balances.set(buyerId, (balances.get(buyerId) ?? 0n) + n);
  for (const s of sales) add(s.buyerId, s.amountCentimes - s.paidCentimes);
  for (const p of payments) add(p.buyerId, -p.amountCentimes);
  for (const u of unpaid) add(u.buyerId, u.amountCentimes);
  return balances;
}

/** V4: a later payment from a buyer, no more than they owe. */
export function checkPayment(amountCentimes: bigint, balanceCentimes: bigint): Result<void, "INVALID_QUANTITY" | "PAID_MORE_THAN_BALANCE"> {
  if (amountCentimes <= 0n) return fail("INVALID_QUANTITY");
  if (amountCentimes > balanceCentimes) return fail("PAID_MORE_THAN_BALANCE");
  return ok(undefined);
}

/** FN12: the ageing columns, by days past the due date. */
export const AGEING_BUCKETS = ["notDue", "1-30", "31-60", "61-90", "90+"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/** FN12: which column a debt sits in, from the days since its due date (SPEC-finance §7: 77 days → 61–90). */
export function ageingBucket(daysPastDue: number): AgeingBucket {
  if (daysPastDue <= 0) return "notDue";
  if (daysPastDue <= 30) return "1-30";
  if (daysPastDue <= 60) return "31-60";
  if (daysPastDue <= 90) return "61-90";
  return "90+";
}

/**
 * FN12: what a buyer owes, split by age. Their debts are what each sale left unpaid (due on the sale day: M1 records no
 * payment terms) and each cheque or bill that came back unpaid (due on its agreed date); later payments settle the
 * oldest first. `daysPastDue(dueOn)` is today − dueOn in farm days.
 */
export function ageing(
  debts: readonly { dueOn: string; amountCentimes: bigint }[],
  paidLaterCentimes: bigint,
  daysPastDue: (dueOn: string) => number,
): Record<AgeingBucket, bigint> {
  const out = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0n])) as Record<AgeingBucket, bigint>;
  let paid = paidLaterCentimes;
  for (const d of [...debts].sort((x, y) => x.dueOn.localeCompare(y.dueOn))) {
    const settled = paid < d.amountCentimes ? paid : d.amountCentimes;
    paid -= settled;
    const left = d.amountCentimes - settled;
    if (left > 0n) out[ageingBucket(daysPastDue(d.dueOn))] += left;
  }
  return out;
}
