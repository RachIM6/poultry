import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { BuyerDto, SaleDto } from "@/modules/sales/schema";

// Buyer and sale repository (Prisma). Scoped to the caller's organisation.

const date = (day: string) => new Date(`${day}T00:00:00Z`); // a farm day, stored as a calendar date

export const buyerIdTaken = async (tx: Tx, id: string) => (await tx.buyer.count({ where: { id } })) > 0;
export const saleIdTaken = async (tx: Tx, id: string) => (await tx.sale.count({ where: { id } })) > 0;
export const ownBuyer = async (tx: Tx, ctx: TenantContext, id: string) => (await tx.buyer.count({ where: { id, organizationId: ctx.organizationId } })) === 1;

export async function saveBuyer(tx: Tx, ctx: TenantContext, b: BuyerDto) {
  await tx.buyer.create({ data: { ...b, organizationId: ctx.organizationId } });
}

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
