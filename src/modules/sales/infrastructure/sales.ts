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
  await tx.buyer.create({ data: { id: b.id, name: b.name, phone: b.phone, type: b.type, address: b.address ?? null, organizationId: ctx.organizationId } }); // no block, no limit yet
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
    payments.map((p) => ({ ...p, day: dayOf(p.day), instrument: p.instrumentNumber && p.instrumentDueOn ? { number: p.instrumentNumber, dueOn: dayOf(p.instrumentDueOn) } : null })),
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
  return buyerDto(b);
}

export const buyerDto = (b: { id: string; name: string; phone: string | null; type: string; creditBlocked: boolean; creditLimitCentimes: bigint | null; address: string | null }): BuyerDto => ({
  id: b.id,
  name: b.name,
  phone: b.phone,
  type: b.type as BuyerDto["type"],
  creditBlocked: b.creditBlocked,
  creditLimitCentimes: b.creditLimitCentimes === null ? null : String(b.creditLimitCentimes),
  address: b.address,
});

/** The register: the buyer's address as stored, or null when the buyer isn't this organisation's. */
export const buyerAddress = (tx: Tx, ctx: TenantContext, buyerId: string) =>
  tx.buyer.findFirst({ where: { id: buyerId, organizationId: ctx.organizationId }, select: { address: true } });

export async function setBuyerAddress(tx: Tx, ctx: TenantContext, buyerId: string, address: string | null): Promise<BuyerDto> {
  return buyerDto(await tx.buyer.update({ where: { id: buyerId, organizationId: ctx.organizationId }, data: { address } }));
}

/** FN12: the buyer's credit limit (null: none) and block. */
export const creditTerms = async (tx: Tx, ctx: TenantContext, buyerId: string) =>
  tx.buyer.findFirst({ where: { id: buyerId, organizationId: ctx.organizationId }, select: { creditBlocked: true, creditLimitCentimes: true } });

export async function setCreditLimit(tx: Tx, ctx: TenantContext, buyerId: string, limit: bigint | null): Promise<BuyerDto> {
  return buyerDto(await tx.buyer.update({ where: { id: buyerId, organizationId: ctx.organizationId }, data: { creditLimitCentimes: limit } }));
}

/** FN12: marks a sale approved; returns it as the phone stores it, or null if it isn't this organisation's or isn't pending. */
export async function approveSaleCredit(tx: Tx, ctx: TenantContext, saleId: string): Promise<Required<SaleDto> | null> {
  const { count } = await tx.sale.updateMany({ where: { id: saleId, organizationId: ctx.organizationId, creditApproval: "pending" }, data: { creditApproval: "approved" } });
  if (count === 0) return null;
  const s = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });
  const lines = await tx.saleLine.findMany({ where: { saleId }, orderBy: { n: "asc" } });
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return {
    id: s.id,
    batchId: s.batchId,
    buyerId: s.buyerId,
    day: day(s.day),
    birds: s.birds,
    farmWeightGrams: s.farmWeightGrams,
    buyerWeightGrams: s.buyerWeightGrams,
    pricePerKgCentimes: String(s.pricePerKgCentimes),
    amountCentimes: String(s.amountCentimes),
    paymentMethod: s.paymentMethod as SaleDto["paymentMethod"] & string,
    paidCentimes: String(s.paidCentimes),
    vatCentimes: String(s.vatCentimes),
    instrument: s.instrumentNumber && s.instrumentDueOn ? { number: s.instrumentNumber, dueOn: day(s.instrumentDueOn) } : null,
    creditApproval: "approved",
    kind: s.kind as "live" | "eggs" | "perHead",
    takenBy: null, // a consumption has no credit to approve
    destination: s.destinationName ? { name: s.destinationName, address: s.destinationAddress } : null,
    lines: lines.map((l) => ({ item: l.item, eggs: l.eggs, eggsPerTray: l.eggsPerTray, unitPriceCentimes: String(l.unitPriceCentimes), amountCentimes: String(l.amountCentimes) })),
  };
}

export const creditBlocked = async (tx: Tx, ctx: TenantContext, buyerId: string) =>
  (await tx.buyer.findFirst({ where: { id: buyerId, organizationId: ctx.organizationId }, select: { creditBlocked: true } }))?.creditBlocked ?? false;

export async function savePayment(tx: Tx, ctx: TenantContext, { instrument, ...p }: PaymentDto) {
  await tx.buyerPayment.create({
    data: {
      ...p,
      organizationId: ctx.organizationId,
      day: date(p.day),
      amountCentimes: BigInt(p.amountCentimes),
      instrumentNumber: instrument?.number ?? null,
      instrumentDueOn: instrument ? date(instrument.dueOn) : null,
      recordedBy: ctx.userId,
    },
  });
}

export type InstrumentRow = { organizationId: string; method: string; number: string; amountCentimes: bigint; buyer: string };

/**
 * V4, for the reminder job, across organisations: marks the cheques and bills due on `day` not yet announced, and
 * returns them with their buyer. A second job at the same moment waits on the row lock, then skips them.
 */
export const claimDueInstruments = async (tx: Tx, day: string, now: Date) => [
  ...(await tx.$queryRaw<InstrumentRow[]>`
    UPDATE "Sale" s SET "instrumentRemindedAt" = ${now}
    FROM "Buyer" b
    WHERE b.id = s."buyerId" AND s."instrumentDueOn" = ${day}::date AND s."instrumentRemindedAt" IS NULL AND s."paidCentimes" > 0
    RETURNING s."organizationId", s."paymentMethod" AS method, s."instrumentNumber" AS number, s."paidCentimes" AS "amountCentimes", b.name AS buyer`), // the part paid with it, as the portfolio shows (instrumentsOf)
  // FN11: a later payment's cheque or bill, when its number and agreed date were given
  ...(await tx.$queryRaw<InstrumentRow[]>`
    UPDATE "BuyerPayment" p SET "instrumentRemindedAt" = ${now}
    FROM "Buyer" b
    WHERE b.id = p."buyerId" AND p."instrumentDueOn" = ${day}::date AND p."instrumentRemindedAt" IS NULL
    RETURNING p."organizationId", p.method, p."instrumentNumber" AS number, p."amountCentimes", b.name AS buyer`),
];

/** SPEC-finance FQ21: the organisation's latest sales of a kind on or before `day`, consumptions aside, for `lastPrices`. */
// ponytail: the last 100 only, so a product not sold in them gets no price; DISTINCT ON per item if that ever bites.
export async function recentSales(tx: Tx, ctx: TenantContext, kind: "live" | "eggs" | "perHead", day: string) {
  const sales = await tx.sale.findMany({
    where: { organizationId: ctx.organizationId, kind, takenBy: null, day: { lte: date(day) } },
    orderBy: [{ day: "desc" }, { id: "desc" }],
    take: 100,
    select: { id: true, day: true, pricePerKgCentimes: true },
  });
  const lines = await tx.saleLine.findMany({ where: { saleId: { in: sales.map((s) => s.id) } }, select: { saleId: true, item: true, unitPriceCentimes: true } });
  return sales.map((s) => ({
    id: s.id,
    day: dayOf(s.day),
    kind,
    pricePerKgCentimes: String(s.pricePerKgCentimes),
    lines: lines.filter((l) => l.saleId === s.id).map((l) => ({ item: l.item, unitPriceCentimes: String(l.unitPriceCentimes) })),
  }));
}

export async function saveSale(tx: Tx, ctx: TenantContext, s: Required<SaleDto>) {
  const { instrument, lines, destination, ...rest } = s;
  await tx.sale.create({
    data: {
      ...rest,
      destinationName: destination?.name ?? null,
      destinationAddress: destination?.address ?? null,
      organizationId: ctx.organizationId,
      day: date(s.day),
      pricePerKgCentimes: BigInt(s.pricePerKgCentimes),
      amountCentimes: BigInt(s.amountCentimes),
      paidCentimes: BigInt(s.paidCentimes),
      vatCentimes: BigInt(s.vatCentimes),
      instrumentNumber: instrument?.number ?? null,
      instrumentDueOn: instrument ? date(instrument.dueOn) : null,
      recordedBy: ctx.userId,
    },
  });
  if (lines.length > 0) {
    await tx.saleLine.createMany({
      data: lines.map((l, n) => ({
        ...l,
        saleId: s.id,
        n,
        organizationId: ctx.organizationId,
        unitPriceCentimes: BigInt(l.unitPriceCentimes),
        amountCentimes: BigInt(l.amountCentimes),
      })),
    });
  }
}
