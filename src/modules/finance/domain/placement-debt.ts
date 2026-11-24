import { fail, ok, type Result } from "@/lib/kernel/result";
import type { Line } from "@/modules/finance/domain/entry";
import type { Posting } from "@/modules/finance/domain/posting";
import { PAID_WITH } from "@/modules/finance/domain/treasury";

// SPEC-finance FN6, FC6, §9 "Placement debts": paying the chicks or point-of-lay hens of a placement, pure.

/** What a placement still owes, and on which account: 4411, or 4481 for point-of-lay hens under the classic method. */
export type PlacementDebt = { account: string; owed: bigint };

/**
 * FN7 posts a placement's purchase under the source (`flock`, batch id), versioned; a newer version reverses the older.
 * The debt is the credit of its standing entry (the latest version, unless reversed) less what was paid for it. Null:
 * nothing posted for it (no price, not posted yet, or reversed by hand).
 */
export function placementDebt(entries: readonly { id: string; version: number; lines: readonly Line[] }[], reversed: ReadonlySet<string>, paid: bigint): PlacementDebt | null {
  const latest = entries.reduce<(typeof entries)[number] | null>((a, e) => (a && a.version >= e.version ? a : e), null);
  const credit = latest && !reversed.has(latest.id) ? latest.lines.find((l) => l.credit > 0n) : undefined;
  return credit ? { account: credit.account, owed: credit.credit - paid } : null;
}

/** A payment is capped at what the placement still owes. */
export function checkPlacementPayment(debt: PlacementDebt | null, amount: bigint): Result<PlacementDebt, "NOTHING_OWED" | "PAID_MORE_THAN_OWED"> {
  if (!debt || debt.owed <= 0n) return fail("NOTHING_OWED");
  return amount > debt.owed ? fail("PAID_MORE_THAN_OWED") : ok(debt);
}

/** D the debt's account / C 5161 or 5141, tagged with the cash box or bank account (FN3). */
export function placementPaymentPosting(debt: PlacementDebt, amount: bigint, paidWith: keyof typeof PAID_WITH, treasuryId: string | null, hatchery: string): Posting {
  const paid = PAID_WITH[paidWith];
  return { journal: paid.journal, label: `Paiement fournisseur : ${hatchery}`, lines: [{ account: debt.account, debit: amount, credit: 0n }, { account: paid.account, debit: 0n, credit: amount, treasuryId }] };
}
