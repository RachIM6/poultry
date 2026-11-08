import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { recordBirdsSold } from "@/modules/flock";
import { withdrawalOn } from "@/modules/health";
import { checkSale } from "@/modules/sales/domain/sale";
import { buyerIdTaken, ownBuyer, saleIdTaken, saveBuyer, saveSale } from "@/modules/sales/infrastructure/sales";
import type { BuyerDto, CreateBuyer, RecordSale, SaleDto } from "@/modules/sales/schema";

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
