import { db, type Tx } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import type { InstrumentKind, InstrumentState } from "@/modules/sales/domain/instruments";
import { instrumentsWhere } from "@/modules/sales/infrastructure/sales";
import type { InstrumentStatusDto, PaymentDto, SaleDto } from "@/modules/sales/shared";

// For finance (SPEC-finance FN7): sales records changed after `after` (this organisation's change-log version), oldest
// first, as the facts finance posts. Amounts in centimes.

export type SaleChange = { version: bigint; id: string; day: FarmDay; amountCentimes: bigint; paidCentimes: bigint; vatCentimes: bigint; method: string; kind: "live" | "eggs" | "perHead" };
export type PaymentChange = { version: bigint; id: string; day: FarmDay; amountCentimes: bigint; method: string };
export type InstrumentStep = { version: bigint; id: string; day: FarmDay; kind: InstrumentKind; from: InstrumentState; to: InstrumentStatusDto["state"]; amountCentimes: bigint };

const changes = async (tx: Tx, ctx: TenantContext, entity: string, after: bigint, limit: number) =>
  (await tx.change.findMany({ where: { organizationId: ctx.organizationId, entity, version: { gt: after } }, orderBy: { version: "asc" }, take: limit })).filter((c) => c.data !== null);

export async function salesChangedSince(tx: Tx, ctx: TenantContext, after: bigint, limit = 500): Promise<SaleChange[]> {
  return (await changes(tx, ctx, "sale", after, limit)).map((c) => {
    const s = c.data as unknown as SaleDto & Required<Omit<SaleDto, "vatCentimes">>; // vatCentimes: absent before T39
    return { version: c.version, id: s.id, day: s.day as FarmDay, amountCentimes: BigInt(s.amountCentimes), paidCentimes: BigInt(s.paidCentimes), vatCentimes: BigInt(s.vatCentimes ?? 0), method: s.paymentMethod, kind: s.kind ?? "live" };
  });
}

export async function paymentsChangedSince(tx: Tx, ctx: TenantContext, after: bigint, limit = 500): Promise<PaymentChange[]> {
  return (await changes(tx, ctx, "buyerPayment", after, limit)).map((c) => {
    const p = c.data as unknown as PaymentDto;
    return { version: c.version, id: p.id, day: p.day as FarmDay, amountCentimes: BigInt(p.amountCentimes), method: p.method };
  });
}

/** FN11: each step of a received cheque or bill, with the state it left (it decides the account credited). */
export async function instrumentStepsChangedSince(tx: Tx, ctx: TenantContext, after: bigint, limit = 500): Promise<InstrumentStep[]> {
  const rows = await changes(tx, ctx, "instrumentStatus", after, limit);
  const steps = rows.map((c) => ({ version: c.version, s: c.data as unknown as InstrumentStatusDto }));
  const ids = [...new Set(steps.map((x) => x.s.instrumentId))];
  const where = { organizationId: ctx.organizationId, id: { in: ids } };
  const [sales, payments, all] = await Promise.all([
    tx.sale.findMany({ where, select: { id: true, paymentMethod: true, paidCentimes: true } }),
    tx.buyerPayment.findMany({ where, select: { id: true, method: true, amountCentimes: true } }),
    tx.instrumentStatus.findMany({ where: { organizationId: ctx.organizationId, instrumentId: { in: ids } }, select: { id: true, instrumentId: true, state: true } }),
  ]);
  const instrument = new Map<string, { kind: InstrumentKind; amount: bigint }>([
    ...sales.map((s) => [s.id, { kind: s.paymentMethod as InstrumentKind, amount: s.paidCentimes }] as const),
    ...payments.map((p) => [p.id, { kind: p.method as InstrumentKind, amount: p.amountCentimes }] as const),
  ]);
  return steps.flatMap(({ version, s }) => {
    const i = instrument.get(s.instrumentId);
    if (!i) return [];
    const before = all.filter((x) => x.instrumentId === s.instrumentId && x.id < s.id).sort((x, y) => x.id.localeCompare(y.id)).at(-1);
    return [{ version, id: s.id, day: s.day as FarmDay, kind: i.kind, from: (before?.state ?? "in_portfolio") as InstrumentState, to: s.state, amountCentimes: i.amount }];
  });
}

/** For finance (SPEC-finance FN13): what each batch's sales came to, in centimes (the farm-weight amount). */
export async function salesByBatch(tx: Tx, ctx: TenantContext): Promise<Map<string, bigint>> {
  const rows = await tx.sale.groupBy({ by: ["batchId"], where: { organizationId: ctx.organizationId }, _sum: { amountCentimes: true } });
  return new Map(rows.map((r) => [r.batchId, r._sum.amountCentimes ?? 0n]));
}

/** For finance's cash schedule (F-Effects): the cheques and bills received and not yet cashed or returned, by due date. */
export async function instrumentsToCollect(ctx: TenantContext): Promise<{ dueOn: string; amountCentimes: bigint }[]> {
  return (await instrumentsWhere(db, ctx, {}))
    .filter((i) => i.state === "in_portfolio" || i.state === "remitted")
    .map((i) => ({ dueOn: i.dueOn, amountCentimes: i.amountCentimes }));
}
