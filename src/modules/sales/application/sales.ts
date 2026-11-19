import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { recordBirdsSold } from "@/modules/flock";
import { eggWithdrawalWindowsOf, withdrawalOn } from "@/modules/health";
import { buyerBalances, checkPayment } from "@/modules/sales/domain/receivables";
import { checkEggSale, checkHeadSale, checkSale, eggLineAmount } from "@/modules/sales/domain/sale";
import { drawEggs } from "@/modules/eggs";
import type { EggItem } from "@/modules/eggs/schema";
import { formatMoney } from "@/lib/format";
import { notify } from "@/modules/notifications";
import { checkTransition } from "@/modules/sales/domain/instruments";
import {
  buyerIdTaken,
  buyerLedger,
  approveSaleCredit,
  creditTerms,
  instrumentsWhere,
  setCreditLimit as saveCreditLimit,
  lockBuyer,
  ownBuyer,
  paymentIdTaken,
  saleIdTaken,
  saveBuyer,
  savePayment,
  saveSale,
  saveStatus,
  setCreditBlocked,
  statusIdTaken,
} from "@/modules/sales/infrastructure/sales";
import type {
  ApproveCredit,
  BuyerDto,
  CreateBuyer,
  InstrumentStatusDto,
  PaymentDto,
  RecordEggSale,
  RecordHeadSale,
  RecordPayment,
  RecordSale,
  SaleDto,
  SetCreditLimit,
  SetInstrumentState,
  UnblockBuyer,
} from "@/modules/sales/schema";

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
  const credit = checked.value.amountCentimes - BigInt(cmd.paidCentimes);
  const decided = await creditDecision(tx, ctx, cmd.buyerId, credit);
  if (!decided.ok) return decided;
  const { creditApproval, terms } = decided.value;

  const sold = await recordBirdsSold(tx, ctx, { id: cmd.id, batchId: cmd.batchId, day: cmd.day, birds: cmd.birds, liveWeightGrams: cmd.farmWeightGrams }, meta, clock);
  if (!sold.ok) return sold; // nothing written yet: flock checks before it writes

  const sale: Required<SaleDto> = { ...cmd, amountCentimes: String(checked.value.amountCentimes), creditApproval, kind: "live", lines: [] };
  await saveSale(tx, ctx, sale);
  await recordChange(tx, ctx, "sale", sale.id, sale);
  await audit(tx, ctx, { entity: "Sale", entityId: sale.id, action: "create", after: sale, ...meta });
  if (creditApproval === "pending") await askOwnerToApprove(tx, ctx, cmd.buyerId, credit, terms!.creditLimitCentimes!, clock);
  return ok(undefined);
}

/**
 * FN12: a buyer whose cheque or bill came back unpaid pays everything at once until the owner lifts the block. A credit
 * sale that takes them past their limit is recorded (the goods have left), but waits for the owner's approval.
 */
async function creditDecision(tx: Tx, ctx: TenantContext, buyerId: string, credit: bigint) {
  const terms = await creditTerms(tx, ctx, buyerId);
  if (credit > 0n && terms?.creditBlocked) return fail("BUYER_CREDIT_BLOCKED");
  let creditApproval: "pending" | null = null;
  if (credit > 0n && terms?.creditLimitCentimes != null && ctx.role !== "owner") {
    await lockBuyer(tx, buyerId);
    const { sales, payments, unpaid } = await buyerLedger(tx, ctx, buyerId);
    const owed = buyerBalances(sales, payments, unpaid).get(buyerId) ?? 0n;
    if (owed + credit > terms.creditLimitCentimes) creditApproval = "pending";
  }
  return ok({ creditApproval, terms });
}

async function askOwnerToApprove(tx: Tx, ctx: TenantContext, buyerId: string, credit: bigint, limit: bigint, clock: Clock) {
  const buyer = await tx.buyer.findUniqueOrThrow({ where: { id: buyerId }, select: { name: true } });
  const params = { buyer: buyer.name, amount: formatMoney(credit), limit: formatMoney(limit) };
  await notify(tx, ctx, { roles: ["owner"], templateKey: "creditApproval", params, urgency: "normal" }, clock);
}

/**
 * SPEC-m3 V6, applied by the sync push: eggs of a layer batch sold by the tray. The eggs leave its stock oldest first
 * (eggs' rule), refused when one was laid during an egg withdrawal (health's windows, H7); payment, receivables and
 * credit as a live sale. Every check before the first write.
 */
export async function recordEggSale(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof RecordEggSale>, meta: Meta, clock: Clock = systemClock) {
  if (await saleIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  if (!(await ownBuyer(tx, ctx, cmd.buyerId))) return fail("NOT_FOUND");
  if (daysBetween(cmd.day as FarmDay, nextFarmDay(farmDayOf(clock.now()))) < 0) return fail("DAY_IN_FUTURE");
  const lines = cmd.lines.map((l) => ({ ...l, unitPriceCentimes: BigInt(l.unitPriceCentimes) }));
  const checked = checkEggSale({ ...cmd, lines, paidCentimes: BigInt(cmd.paidCentimes) });
  if (!checked.ok) return checked;
  const credit = checked.value.amountCentimes - BigInt(cmd.paidCentimes);
  const decided = await creditDecision(tx, ctx, cmd.buyerId, credit);
  if (!decided.ok) return decided;

  const withheld = await eggWithdrawalWindowsOf(tx, ctx, cmd.batchId);
  const drawn = await drawEggs(tx, ctx, { saleId: cmd.id, batchId: cmd.batchId, wanted: cmd.lines.map((l) => ({ item: l.item as EggItem, eggs: l.eggs })), withheld });
  if (!drawn.ok) return drawn; // nothing written yet: eggs checks before it writes

  const sale: Required<SaleDto> = {
    id: cmd.id,
    batchId: cmd.batchId,
    buyerId: cmd.buyerId,
    day: cmd.day,
    birds: 0,
    farmWeightGrams: 0,
    buyerWeightGrams: null,
    pricePerKgCentimes: "0",
    amountCentimes: String(checked.value.amountCentimes),
    paymentMethod: cmd.paymentMethod,
    paidCentimes: cmd.paidCentimes,
    instrument: cmd.instrument,
    creditApproval: decided.value.creditApproval,
    kind: "eggs",
    lines: lines.map((l) => ({ ...l, unitPriceCentimes: String(l.unitPriceCentimes), amountCentimes: String(eggLineAmount(l)) })),
  };
  await saveSale(tx, ctx, sale);
  await recordChange(tx, ctx, "sale", sale.id, sale);
  await audit(tx, ctx, { entity: "Sale", entityId: sale.id, action: "create", after: sale, ...meta });
  if (decided.value.creditApproval === "pending") await askOwnerToApprove(tx, ctx, cmd.buyerId, credit, decided.value.terms!.creditLimitCentimes!, clock);
  return ok(undefined);
}

/** SPEC V4, applied by the sync push: a buyer pays later, up to what they owe, under the buyer's lock. */
export async function recordPayment(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof RecordPayment>, meta: Meta, clock: Clock = systemClock) {
  if (await paymentIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  if (!(await ownBuyer(tx, ctx, cmd.buyerId))) return fail("NOT_FOUND");
  if (daysBetween(cmd.day as FarmDay, nextFarmDay(farmDayOf(clock.now()))) < 0) return fail("DAY_IN_FUTURE"); // a phone may run a little ahead
  await lockBuyer(tx, cmd.buyerId);
  const { sales, payments, unpaid } = await buyerLedger(tx, ctx, cmd.buyerId);
  const checked = checkPayment(BigInt(cmd.amountCentimes), buyerBalances(sales, payments, unpaid).get(cmd.buyerId) ?? 0n);
  if (!checked.ok) return checked;

  const payment: PaymentDto = cmd;
  await savePayment(tx, ctx, payment);
  await recordChange(tx, ctx, "buyerPayment", payment.id, payment);
  await audit(tx, ctx, { entity: "BuyerPayment", entityId: payment.id, action: "create", after: payment, ...meta });
  return ok(undefined);
}

/**
 * SPEC-finance FN11, applied by the sync push: a received cheque or bill is remitted, cashed or comes back unpaid,
 * forward only, under the buyer's lock. Unpaid puts the amount back on what the buyer owes and blocks their credit
 * (FN12). Finance posts each step (T30's pipeline).
 */
export async function setInstrumentState(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof SetInstrumentState>, meta: Meta, clock: Clock = systemClock) {
  if (await statusIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  const [instrument] = await instrumentsWhere(tx, ctx, { id: cmd.instrumentId });
  if (!instrument) return fail("NOT_FOUND");
  if (daysBetween(cmd.day as FarmDay, nextFarmDay(farmDayOf(clock.now()))) < 0) return fail("DAY_IN_FUTURE");
  await lockBuyer(tx, instrument.buyerId);
  const [current] = await instrumentsWhere(tx, ctx, { id: cmd.instrumentId }); // read again under the lock
  const checked = checkTransition(current.state, cmd.state);
  if (!checked.ok) return checked;

  const status: InstrumentStatusDto = cmd;
  await saveStatus(tx, ctx, status);
  await recordChange(tx, ctx, "instrumentStatus", status.id, status);
  await audit(tx, ctx, { entity: "InstrumentStatus", entityId: status.id, action: "create", after: status, ...meta });
  if (cmd.state === "unpaid") {
    const buyer = await setCreditBlocked(tx, ctx, instrument.buyerId, true);
    await recordChange(tx, ctx, "buyer", buyer.id, buyer);
  }
  return ok(undefined);
}

/** FN12: the owner lets the buyer buy on credit again. */
export async function unblockBuyer(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof UnblockBuyer>, meta: Meta) {
  if (!(await ownBuyer(tx, ctx, cmd.buyerId))) return fail("NOT_FOUND");
  const buyer = await setCreditBlocked(tx, ctx, cmd.buyerId, false);
  await recordChange(tx, ctx, "buyer", buyer.id, buyer);
  await audit(tx, ctx, { entity: "Buyer", entityId: buyer.id, action: "unblock", after: buyer, ...meta });
  return ok(undefined);
}

/** FN12: the owner sets a buyer's credit limit (null removes it). */
export async function setCreditLimit(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof SetCreditLimit>, meta: Meta) {
  if (!(await ownBuyer(tx, ctx, cmd.buyerId))) return fail("NOT_FOUND");
  const buyer = await saveCreditLimit(tx, ctx, cmd.buyerId, cmd.limitCentimes === null ? null : BigInt(cmd.limitCentimes));
  await recordChange(tx, ctx, "buyer", buyer.id, buyer);
  await audit(tx, ctx, { entity: "Buyer", entityId: buyer.id, action: "creditLimit", after: buyer, ...meta });
  return ok(undefined);
}

/** FN12: the owner approves a credit sale that went past the buyer's limit. */
export async function approveCredit(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof ApproveCredit>, meta: Meta) {
  const sale = await approveSaleCredit(tx, ctx, cmd.saleId);
  if (!sale) return fail("NOT_FOUND");
  await recordChange(tx, ctx, "sale", sale.id, sale);
  await audit(tx, ctx, { entity: "Sale", entityId: sale.id, action: "approveCredit", after: { creditApproval: "approved" }, ...meta });
  return ok(undefined);
}

/**
 * SPEC-m3 V7, applied by the sync push: live birds sold by the head (beldi roosters and hens, quail, ducks, old hens).
 * Blocked during a withdrawal (V3), the birds leave the batch through flock (B5), money as a live sale.
 */
export async function recordHeadSale(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof RecordHeadSale>, meta: Meta, clock: Clock = systemClock) {
  if (await saleIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  if (!(await ownBuyer(tx, ctx, cmd.buyerId))) return fail("NOT_FOUND");
  const lines = cmd.lines.map((l) => ({ ...l, pricePerHeadCentimes: BigInt(l.pricePerHeadCentimes) }));
  const checked = checkHeadSale({ ...cmd, lines, paidCentimes: BigInt(cmd.paidCentimes) }, await withdrawalOn(tx, ctx, cmd.batchId, cmd.day as FarmDay));
  if (!checked.ok) return checked;
  const credit = checked.value.amountCentimes - BigInt(cmd.paidCentimes);
  const decided = await creditDecision(tx, ctx, cmd.buyerId, credit);
  if (!decided.ok) return decided;

  const sold = await recordBirdsSold(tx, ctx, { id: cmd.id, batchId: cmd.batchId, day: cmd.day, birds: checked.value.birds, liveWeightGrams: cmd.farmWeightGrams ?? 0 }, meta, clock);
  if (!sold.ok) return sold; // nothing written yet: flock checks before it writes

  const sale: Required<SaleDto> = {
    id: cmd.id,
    batchId: cmd.batchId,
    buyerId: cmd.buyerId,
    day: cmd.day,
    birds: checked.value.birds,
    farmWeightGrams: cmd.farmWeightGrams ?? 0,
    buyerWeightGrams: null,
    pricePerKgCentimes: "0",
    amountCentimes: String(checked.value.amountCentimes),
    paymentMethod: cmd.paymentMethod,
    paidCentimes: cmd.paidCentimes,
    instrument: cmd.instrument,
    creditApproval: decided.value.creditApproval,
    kind: "perHead",
    lines: lines.map((l) => ({ item: l.item, eggs: l.birds, eggsPerTray: 1, unitPriceCentimes: String(l.pricePerHeadCentimes), amountCentimes: String(BigInt(l.birds) * l.pricePerHeadCentimes) })),
  };
  await saveSale(tx, ctx, sale);
  await recordChange(tx, ctx, "sale", sale.id, sale);
  await audit(tx, ctx, { entity: "Sale", entityId: sale.id, action: "create", after: sale, ...meta });
  if (decided.value.creditApproval === "pending") await askOwnerToApprove(tx, ctx, cmd.buyerId, credit, decided.value.terms!.creditLimitCentimes!, clock);
  return ok(undefined);
}
