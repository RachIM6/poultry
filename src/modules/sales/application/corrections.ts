import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { undrawEggs } from "@/modules/eggs";
import { removeBirdsSold } from "@/modules/flock";
import { askOwnerToApprove, creditDecision } from "@/modules/sales/application/sales";
import { repriceSale } from "@/modules/sales/domain/correction";
import { buyerBalances } from "@/modules/sales/domain/receivables";
import { buyerLedger, deleteSale, findSale, instrumentsWhere, lockBuyer, savePrices } from "@/modules/sales/infrastructure/sales";
import type { CancelSale, CorrectSale, SaleDto } from "@/modules/sales/schema";

// SPEC-finance §9 "Cancelled records", applied by the sync push (owners and managers): a sale typed wrong is cancelled
// and typed again, or has its prices corrected. Finance reverses its entry, or reposts it, from the change log (FN7).

type Meta = { mutationId: string; deviceCreatedAt: Date };

/**
 * What the buyer would owe once the sale's unpaid part becomes `unpaid`, read under the buyer's lock. Below zero: their
 * later payments already cover the part going away, so the sale stays until a payment can be cancelled (none can in v1).
 */
async function owedWithout(tx: Tx, ctx: TenantContext, sale: Required<SaleDto>, unpaid: bigint) {
  if (!sale.buyerId) return 0n; // a home consumption (FC7) is owed by no one
  await lockBuyer(tx, sale.buyerId);
  const { sales, payments, unpaid: returned } = await buyerLedger(tx, ctx, sale.buyerId);
  const others = sales.filter((s) => s.id !== sale.id);
  return (buyerBalances(others, payments, returned).get(sale.buyerId) ?? 0n) + unpaid;
}

/** A sale's cheque or bill that was already remitted, cashed or came back unpaid (FN11): the sale can't go. */
const instrumentMoved = async (tx: Tx, ctx: TenantContext, saleId: string) => {
  const [instrument] = await instrumentsWhere(tx, ctx, { id: saleId });
  return instrument !== undefined && instrument.state !== "in_portfolio";
};

/**
 * A live-bird, per-head, egg or home-consumption sale cancelled: its birds come back to the batch (flock), its eggs to
 * the stock (eggs), it leaves the buyer's balance, and the phones drop it. The part paid at the sale goes with it (its
 * entry is reversed whole). Refused once its cheque or bill moved, once the buyer's later payments cover it, and once its
 * batch closed (birds can't come back to a closed batch). Every check before the first write.
 */
export async function cancelSale(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof CancelSale>, meta: Meta) {
  const sale = await findSale(tx, ctx, cmd.saleId);
  if (!sale) return fail("NOT_FOUND");
  if (await instrumentMoved(tx, ctx, sale.id)) return fail("SALE_HAS_PAYMENT");
  if ((await owedWithout(tx, ctx, sale, 0n)) < 0n) return fail("SALE_HAS_PAYMENT");

  const back = await removeBirdsSold(tx, ctx, sale.id); // checks the batch before it writes
  if (!back.ok) return back;
  await undrawEggs(tx, ctx, sale.id);
  await deleteSale(tx, ctx, sale.id);
  await recordChange(tx, ctx, "sale", sale.id, null);
  await audit(tx, ctx, { entity: "Sale", entityId: sale.id, action: "cancel", before: sale, ...meta });
  return ok(undefined);
}

/**
 * A sale's prices and VAT corrected (a typo: 145,00 for 14,50 a kg); quantities, buyer, day and payment stay (else:
 * cancel and type it again). Also on a closed batch: no bird moves. Refused when the new amount is below what was paid
 * at the sale, or below what the buyer's later payments already cover; more credit goes through the buyer's block and
 * limit as a new sale's (FN12).
 */
export async function correctSale(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof CorrectSale>, meta: Meta, clock: Clock = systemClock) {
  const before = await findSale(tx, ctx, cmd.saleId);
  if (!before) return fail("NOT_FOUND");
  const vat = BigInt(cmd.vatCentimes);
  if (before.takenBy && vat > 0n) return fail("INVALID_INPUT"); // a home consumption has no invoice
  const priced = repriceSale(before, { pricePerKgCentimes: cmd.pricePerKgCentimes === null ? null : BigInt(cmd.pricePerKgCentimes), linePrices: cmd.linePrices.map(BigInt), vatCentimes: vat });
  if (!priced.ok) return priced;
  const { amountCentimes } = priced.value;
  const paid = BigInt(before.paidCentimes);
  if ((await owedWithout(tx, ctx, before, amountCentimes - paid)) < 0n) return fail("SALE_HAS_PAYMENT");
  const more = amountCentimes - BigInt(before.amountCentimes);
  const decided = before.buyerId && more > 0n ? await creditDecision(tx, ctx, before.buyerId, more) : null;
  if (decided && !decided.ok) return decided;

  const after: Required<SaleDto> = {
    ...before,
    pricePerKgCentimes: String(priced.value.pricePerKgCentimes),
    amountCentimes: String(amountCentimes),
    vatCentimes: String(vat),
    lines: priced.value.lines,
    creditApproval: decided?.value.creditApproval ?? before.creditApproval,
  };
  await savePrices(tx, ctx, after);
  await recordChange(tx, ctx, "sale", after.id, after);
  const money = (s: Required<SaleDto>) => ({ pricePerKgCentimes: s.pricePerKgCentimes, amountCentimes: s.amountCentimes, vatCentimes: s.vatCentimes, lines: s.lines, creditApproval: s.creditApproval });
  await audit(tx, ctx, { entity: "Sale", entityId: after.id, action: "correct", before: money(before), after: money(after), ...meta });
  if (decided?.value.creditApproval === "pending") await askOwnerToApprove(tx, ctx, before.buyerId!, amountCentimes - paid, decided.value.terms!.creditLimitCentimes!, clock);
  return ok(undefined);
}
