import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, latestRecordableDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { drawEggs } from "@/modules/eggs";
import type { EggItem } from "@/modules/eggs/schema";
import { recordBirdsSold } from "@/modules/flock";
import { eggWithdrawalWindowsOf, withdrawalOn } from "@/modules/health";
import { lastPrices } from "@/modules/sales/domain/consumption";
import { eggLineAmount, saleAmount } from "@/modules/sales/domain/sale";
import { recentSales, saleIdTaken, saveSale } from "@/modules/sales/infrastructure/sales";
import type { RecordConsumption, SaleDto } from "@/modules/sales/schema";

type Meta = { mutationId: string; deviceCreatedAt: Date };

/**
 * SPEC-finance FC7, applied by the sync push: birds or eggs taken home by the exploitant, an associate or an employee.
 * As a sale of the same product: refused during a withdrawal (V3; eggs: H7's windows), birds on hand lowered through
 * flock (B5), eggs drawn oldest first (V6). No buyer, payment or receivable. Valued at the typed price, else at the last
 * sale's (FQ21); a worker's entry carries none and any it carries is ignored (I5). Every check before the first write.
 */
export async function recordConsumption(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof RecordConsumption>, meta: Meta, clock: Clock = systemClock) {
  if (await saleIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  const last = lastPrices(await recentSales(tx, ctx, cmd.kind, cmd.day), cmd.kind, cmd.day);
  const priceOf = (typed: string | null, item: string) => (typed !== null && can(ctx, "money.read") ? BigInt(typed) : (last.get(item) ?? 0n));
  const base = { id: cmd.id, batchId: cmd.batchId, buyerId: null, day: cmd.day, buyerWeightGrams: null, paymentMethod: "none" as const, paidCentimes: "0", vatCentimes: "0", instrument: null, creditApproval: null, kind: cmd.kind, takenBy: cmd.takenBy, destination: null };
  let sale: Required<SaleDto>;

  if (cmd.kind === "eggs") {
    if (daysBetween(cmd.day as FarmDay, latestRecordableDay(clock)) < 0) return fail("DAY_IN_FUTURE");
    const lines = cmd.lines.map((l) => ({ ...l, unitPriceCentimes: priceOf(l.unitPriceCentimes, l.item) }));
    const withheld = await eggWithdrawalWindowsOf(tx, ctx, cmd.batchId);
    const drawn = await drawEggs(tx, ctx, { saleId: cmd.id, batchId: cmd.batchId, day: cmd.day, wanted: lines.map((l) => ({ item: l.item as EggItem, eggs: l.eggs })), withheld });
    if (!drawn.ok) return drawn; // nothing written yet: eggs checks before it writes
    const priced = lines.map((l) => ({ ...l, unitPriceCentimes: String(l.unitPriceCentimes), amountCentimes: String(eggLineAmount(l)) }));
    sale = { ...base, birds: 0, farmWeightGrams: 0, pricePerKgCentimes: "0", amountCentimes: String(priced.reduce((a, l) => a + BigInt(l.amountCentimes), 0n)), lines: priced };
  } else {
    if (await withdrawalOn(tx, ctx, cmd.batchId, cmd.day as FarmDay)) return fail("WITHDRAWAL_IN_PROGRESS");
    if (cmd.kind === "live") {
      const price = priceOf(cmd.pricePerKgCentimes, "kg");
      sale = { ...base, birds: cmd.birds, farmWeightGrams: cmd.farmWeightGrams, pricePerKgCentimes: String(price), amountCentimes: String(saleAmount(cmd.farmWeightGrams, price)), lines: [] };
    } else {
      const lines = cmd.lines.map((l) => {
        const price = priceOf(l.pricePerHeadCentimes, l.item);
        return { item: l.item, eggs: l.birds, eggsPerTray: 1, unitPriceCentimes: String(price), amountCentimes: String(BigInt(l.birds) * price) };
      });
      const birds = lines.reduce((n, l) => n + l.eggs, 0);
      sale = { ...base, birds, farmWeightGrams: cmd.farmWeightGrams ?? 0, pricePerKgCentimes: "0", amountCentimes: String(lines.reduce((a, l) => a + BigInt(l.amountCentimes), 0n)), lines };
    }
    const sold = await recordBirdsSold(tx, ctx, { id: cmd.id, batchId: cmd.batchId, day: cmd.day, birds: sale.birds, liveWeightGrams: sale.farmWeightGrams }, meta, clock);
    if (!sold.ok) return sold; // nothing written yet: flock checks before it writes
  }

  await saveSale(tx, ctx, sale);
  await recordChange(tx, ctx, "sale", sale.id, sale);
  await audit(tx, ctx, { entity: "Sale", entityId: sale.id, action: "consume", after: sale, ...meta });
  return ok(undefined);
}
