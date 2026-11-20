import { fail, ok, type Result } from "@/lib/kernel/result";

// S2, SPEC-finance FN6, FN12: what is owed to suppliers. Its own file: /batches ships domain/stock.ts (daily entry).

/** S2: balance owed to each supplier = purchases − what was paid with them − later payments. */
export function supplierBalances(
  purchases: readonly { supplierId: string; amountCentimes: bigint; paidCentimes: bigint }[],
  payments: readonly { supplierId: string; amountCentimes: bigint }[] = [],
) {
  const balances = new Map<string, bigint>();
  const add = (id: string, c: bigint) => balances.set(id, (balances.get(id) ?? 0n) + c);
  for (const p of purchases) add(p.supplierId, p.amountCentimes - p.paidCentimes);
  for (const p of payments) add(p.supplierId, -p.amountCentimes);
  return balances;
}

/**
 * SPEC-finance FN12, supplier side: what is still due, by due date (a purchase without one is due on its day), later
 * payments settling the oldest due first, as for buyers.
 */
export function supplierDues(purchases: readonly { day: string; dueOn: string | null; amountCentimes: bigint; paidCentimes: bigint }[], paidLaterCentimes: bigint) {
  const out: { dueOn: string; amountCentimes: bigint }[] = [];
  let paid = paidLaterCentimes;
  const debts = purchases.map((p) => ({ dueOn: p.dueOn ?? p.day, amount: p.amountCentimes - p.paidCentimes })).filter((d) => d.amount > 0n);
  for (const d of debts.sort((x, y) => x.dueOn.localeCompare(y.dueOn))) {
    const settled = paid < d.amount ? paid : d.amount;
    paid -= settled;
    if (d.amount > settled) {
      const same = out.at(-1)?.dueOn === d.dueOn ? out.at(-1)! : null;
      if (same) same.amountCentimes += d.amount - settled;
      else out.push({ dueOn: d.dueOn, amountCentimes: d.amount - settled });
    }
  }
  return out;
}

/** S2, SPEC-finance FN6: a later payment to a supplier, up to what is owed. */
export function checkSupplierPayment(amountCentimes: bigint, balanceCentimes: bigint): Result<void, "INVALID_QUANTITY" | "PAID_MORE_THAN_OWED"> {
  if (amountCentimes <= 0n) return fail("INVALID_QUANTITY");
  return amountCentimes > balanceCentimes ? fail("PAID_MORE_THAN_OWED") : ok(undefined);
}
