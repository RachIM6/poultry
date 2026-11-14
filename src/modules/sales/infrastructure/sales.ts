import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { instrumentsOf, type Instrument } from "@/modules/sales/domain/instruments";
import type { BuyerDto, InstrumentStatusDto, PaymentDto, SaleDto } from "@/modules/sales/schema";

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

/** V4, FN11: one buyer's sales, later payments and the cheques and bills that came back unpaid, for the balance. */
export async function buyerLedger(tx: Tx, ctx: TenantContext, buyerId: string) {
  const instruments = await instrumentsWhere(tx, ctx, { buyerId });
  const where = { organizationId: ctx.organizationId, buyerId };
  const [sales, payments] = await Promise.all([
    tx.sale.findMany({ where, select: { buyerId: true, amountCentimes: true, paidCentimes: true } }),
    tx.buyerPayment.findMany({ where, select: { buyerId: true, amountCentimes: true } }),
  ]);
  return { sales, payments, unpaid: instruments.filter((i) => i.state === "unpaid") };
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** FN11: the received cheques and bills of this organisation matching `where` (a buyer, or one instrument's id). */
export async function instrumentsWhere(tx: Tx, ctx: TenantContext, where: { buyerId?: string; id?: string }): Promise<Instrument[]> {
  const scope = { organizationId: ctx.organizationId, ...where };
  const [sales, payments] = await Promise.all([
    tx.sale.findMany({ where: { ...scope, paymentMethod: { in: ["cheque", "bill"] } } }),
    tx.buyerPayment.findMany({ where: { ...scope, method: { in: ["cheque", "bill"] } } }),
  ]);
  const ids = [...sales, ...payments].map((x) => x.id);
  const statuses = await tx.instrumentStatus.findMany({ where: { organizationId: ctx.organizationId, instrumentId: { in: ids } } });
  return instrumentsOf(
    sales.map((s) => ({
      ...s,
      day: dayOf(s.day),
      instrument: s.instrumentNumber && s.instrumentDueOn ? { number: s.instrumentNumber, dueOn: dayOf(s.instrumentDueOn) } : null,
    })),
    payments.map((p) => ({ ...p, day: dayOf(p.day) })),
    statuses.map((s) => ({ ...s, state: s.state as InstrumentStatusDto["state"] })),
  );
}

export const statusIdTaken = async (tx: Tx, id: string) => (await tx.instrumentStatus.count({ where: { id } })) > 0;

export async function saveStatus(tx: Tx, ctx: TenantContext, s: InstrumentStatusDto) {
  await tx.instrumentStatus.create({ data: { ...s, organizationId: ctx.organizationId, day: date(s.day), recordedBy: ctx.userId } });
}

/** FN12: sets the buyer's credit block; returns the buyer as the phone stores it. */
export async function setCreditBlocked(tx: Tx, ctx: TenantContext, buyerId: string, blocked: boolean): Promise<BuyerDto> {
  const b = await tx.buyer.update({ where: { id: buyerId, organizationId: ctx.organizationId }, data: { creditBlocked: blocked } });
  return { id: b.id, name: b.name, phone: b.phone, type: b.type as BuyerDto["type"], creditBlocked: b.creditBlocked };
}

export const creditBlocked = async (tx: Tx, ctx: TenantContext, buyerId: string) =>
  (await tx.buyer.findFirst({ where: { id: buyerId, organizationId: ctx.organizationId }, select: { creditBlocked: true } }))?.creditBlocked ?? false;

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
