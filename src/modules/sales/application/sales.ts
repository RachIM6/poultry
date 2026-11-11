import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { recordBirdsSold } from "@/modules/flock";
import { withdrawalOn } from "@/modules/health";
import { buyerBalances, checkPayment } from "@/modules/sales/domain/receivables";
import { checkSale } from "@/modules/sales/domain/sale";
import { buyerIdTaken, buyerLedger, lockBuyer, ownBuyer, paymentIdTaken, saleIdTaken, saveBuyer, savePayment, saveSale } from "@/modules/sales/infrastructure/sales";
import type { BuyerDto, CreateBuyer, PaymentDto, RecordPayment, RecordSale, SaleDto } from "@/modules/sales/schema";

type Meta = { mutationId: string; deviceCreatedAt: Date };

/** SPEC V1, applied by the sync push. */
export async function createBuyer(tx: Tx, ctx: TenantContext, cmd: z.output<typeof CreateBuyer>, meta: Meta) {
  if (await buyerIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  const buyer: BuyerDto = cmd;
  await saveBuyer(tx, ctx, buyer);
  await recordChange(tx, ctx, "buyer", buyer.id, buyer);
  await audit(tx, ctx, { entity: "Buyer", entityId: buyer.id, action: "create", after: buyer, ...meta });
  return ok(undefined);
}

/**
 * SPEC V2, V3, B5, applied by the sync push. Refused while a withdrawal runs on the batch on the sale day (health's
 * rule), also when the sale was made offline and arrives later. The birds leave the batch through flock, and the amount
 * is computed here from the farm weight, all in one transaction, with every check before the first write.
 */
export async function recordSale(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof RecordSale>, meta: Meta, clock: Clock = systemClock) {
  if (await saleIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  if (!(await ownBuyer(tx, ctx, cmd.buyerId))) return fail("NOT_FOUND");
  const checked = checkSale(
    { ...cmd, pricePerKgCentimes: BigInt(cmd.pricePerKgCentimes), paidCentimes: BigInt(cmd.paidCentimes) },
    await withdrawalOn(tx, ctx, cmd.batchId, cmd.day as FarmDay),
  );
  if (!checked.ok) return checked;

  const sold = await recordBirdsSold(tx, ctx, { id: cmd.id, batchId: cmd.batchId, day: cmd.day, birds: cmd.birds, liveWeightGrams: cmd.farmWeightGrams }, clock);
  if (!sold.ok) return sold; // nothing written yet: flock checks before it writes

  const sale: Required<SaleDto> = { ...cmd, amountCentimes: String(checked.value.amountCentimes) };
  await saveSale(tx, ctx, sale);
  await recordChange(tx, ctx, "sale", sale.id, sale);
  await audit(tx, ctx, { entity: "Sale", entityId: sale.id, action: "create", after: sale, ...meta });
  return ok(undefined);
}

/** SPEC V4, applied by the sync push: a buyer pays later, up to what they owe, under the buyer's lock. */
export async function recordPayment(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof RecordPayment>, meta: Meta, clock: Clock = systemClock) {
  if (await paymentIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  if (!(await ownBuyer(tx, ctx, cmd.buyerId))) return fail("NOT_FOUND");
  if (daysBetween(cmd.day as FarmDay, nextFarmDay(farmDayOf(clock.now()))) < 0) return fail("DAY_IN_FUTURE"); // a phone may run a little ahead
  await lockBuyer(tx, cmd.buyerId);
  const { sales, payments } = await buyerLedger(tx, ctx, cmd.buyerId);
  const checked = checkPayment(BigInt(cmd.amountCentimes), buyerBalances(sales, payments).get(cmd.buyerId) ?? 0n);
  if (!checked.ok) return checked;

  const payment: PaymentDto = cmd;
  await savePayment(tx, ctx, payment);
  await recordChange(tx, ctx, "buyerPayment", payment.id, payment);
  await audit(tx, ctx, { entity: "BuyerPayment", entityId: payment.id, action: "create", after: payment, ...meta });
  return ok(undefined);
}
