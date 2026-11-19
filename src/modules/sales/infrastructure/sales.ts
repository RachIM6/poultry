import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { BuyerDto, PaymentDto, SaleDto } from "@/modules/sales/schema";

// Buyer and sale repository (Prisma). Scoped to the caller's organisation.

const date = (day: string) => new Date(`${day}T00:00:00Z`); // a farm day, stored as a calendar date

export const buyerIdTaken = async (tx: Tx, id: string) => (await tx.buyer.count({ where: { id } })) > 0;
export const saleIdTaken = async (tx: Tx, id: string) => (await tx.sale.count({ where: { id } })) > 0;
export const ownBuyer = async (tx: Tx, ctx: TenantContext, id: string) => (await tx.buyer.count({ where: { id, organizationId: ctx.organizationId } })) === 1;

export async function saveBuyer(tx: Tx, ctx: TenantContext, b: BuyerDto) {
  await tx.buyer.create({ data: { ...b, organizationId: ctx.organizationId } });
}

export const paymentIdTaken = async (tx: Tx, id: string) => (await tx.buyerPayment.count({ where: { id } })) > 0;

/** V4: serializes a buyer's payments until the transaction ends, so two can't both pass the balance check. */
export const lockBuyer = (tx: Tx, buyerId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${buyerId}, 2))`;

/** V4: one buyer's unpaid sales and later payments, in the shape of the domain's balance. */
export async function buyerLedger(tx: Tx, ctx: TenantContext, buyerId: string) {
  const where = { organizationId: ctx.organizationId, buyerId };
  const [sales, payments] = await Promise.all([
    tx.sale.findMany({ where, select: { buyerId: true, amountCentimes: true, paidCentimes: true } }),
    tx.buyerPayment.findMany({ where, select: { buyerId: true, amountCentimes: true } }),
  ]);
  return { sales, payments };
}

export async function savePayment(tx: Tx, ctx: TenantContext, p: PaymentDto) {
  await tx.buyerPayment.create({ data: { ...p, organizationId: ctx.organizationId, day: date(p.day), amountCentimes: BigInt(p.amountCentimes), recordedBy: ctx.userId } });
}

export type InstrumentRow = { organizationId: string; method: string; number: string; amountCentimes: bigint; buyer: string };

/**
 * V4, for the reminder job, across organisations: marks the cheques and bills due on `day` not yet announced, and
 * returns them with their buyer. A second job at the same moment waits on the row lock, then skips them.
 */
export const claimDueInstruments = (tx: Tx, day: string, now: Date) => tx.$queryRaw<InstrumentRow[]>`
  UPDATE "Sale" s SET "instrumentRemindedAt" = ${now}
  FROM "Buyer" b
  WHERE b.id = s."buyerId" AND s."instrumentDueOn" = ${day}::date AND s."instrumentRemindedAt" IS NULL
  RETURNING s."organizationId", s."paymentMethod" AS method, s."instrumentNumber" AS number, s."amountCentimes", b.name AS buyer`;

export async function saveSale(tx: Tx, ctx: TenantContext, s: Required<SaleDto>) {
  const { instrument, ...rest } = s;
  await tx.sale.create({
    data: {
      ...rest,
      organizationId: ctx.organizationId,
      day: date(s.day),
      pricePerKgCentimes: BigInt(s.pricePerKgCentimes),
      amountCentimes: BigInt(s.amountCentimes),
      paidCentimes: BigInt(s.paidCentimes),
      instrumentNumber: instrument?.number ?? null,
      instrumentDueOn: instrument ? date(instrument.dueOn) : null,
      recordedBy: ctx.userId,
    },
  });
}
