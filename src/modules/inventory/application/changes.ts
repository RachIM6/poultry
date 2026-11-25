import { db, type Tx } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { supplierDues } from "@/modules/inventory/domain/suppliers";
import { issuedOfOrg } from "@/modules/inventory/infrastructure/repository";
import type { IssuedDebitDto, PurchaseDto, SupplierPaymentDto } from "@/modules/inventory/shared";

export type PurchaseChange = { version: bigint; id: string; farmId: string; day: FarmDay; itemKind: string; amountCentimes: bigint; paidCentimes: bigint; vatCentimes: bigint; paidMethod: string };

/** FN7, SPEC-finance §9 "Cancelled records": a purchase cancelled since; finance reverses its standing entry. */
export type Voided = { version: bigint; voided: string };

/**
 * For finance (SPEC-finance FN7): purchases recorded, changed or cancelled after `after` (this organisation's
 * change-log version), oldest first, with the kind of item bought (it picks the charge account). Each of these reads
 * also returns `readTo`, the last version it read (dropped changes included), where finance's cursor moves (§9).
 */
export async function purchasesChangedSince(tx: Tx, ctx: TenantContext, after: bigint, limit = 500): Promise<{ items: (PurchaseChange | Voided)[]; readTo: bigint }> {
  const changes = await tx.change.findMany({
    where: { organizationId: ctx.organizationId, entity: "purchase", version: { gt: after } },
    orderBy: { version: "asc" },
    take: limit,
  });
  const purchases = changes.filter((c) => c.data !== null).map((c) => c.data as unknown as PurchaseDto & Required<Omit<PurchaseDto, "vatCentimes" | "paidMethod">>);
  const items = await tx.stockItem.findMany({ where: { organizationId: ctx.organizationId, id: { in: purchases.map((p) => p.stockItemId) } } });
  const kindOf = new Map(items.map((i) => [i.id, i.kind]));
  const out = changes.map(({ version, entityId, data }): PurchaseChange | Voided => {
    if (data === null) return { version, voided: entityId };
    const p = data as unknown as (typeof purchases)[number];
    return {
      version,
      id: p.id,
      farmId: p.farmId,
      day: p.day as FarmDay,
      itemKind: kindOf.get(p.stockItemId) ?? "other",
      amountCentimes: BigInt(p.amountCentimes),
      paidCentimes: BigInt(p.paidCentimes),
      vatCentimes: BigInt(p.vatCentimes ?? 0), // absent before T39
      paidMethod: p.paidMethod ?? "cash", // absent before purchases had one: cash, as they were posted
    };
  });
  return { items: out, readTo: changes.at(-1)?.version ?? after };
}

/** For finance (SPEC-finance FN6, FN7): later supplier payments recorded after `after`, oldest first. */
export async function supplierPaymentsChangedSince(tx: Tx, ctx: TenantContext, after: bigint, limit = 500) {
  const changes = await tx.change.findMany({
    where: { organizationId: ctx.organizationId, entity: "supplierPayment", version: { gt: after } },
    orderBy: { version: "asc" },
    take: limit,
  });
  const items = changes.filter((c) => c.data !== null).map((c) => ({ version: c.version, ...(c.data as unknown as SupplierPaymentDto) }));
  return { items, readTo: changes.at(-1)?.version ?? after };
}

/** For finance's cash schedule (FN12, F-Effects): what is still due to the suppliers, by due date. */
export async function supplierDuesOf(ctx: TenantContext): Promise<{ dueOn: string; amountCentimes: bigint }[]> {
  const where = { organizationId: ctx.organizationId };
  const [purchases, payments] = await Promise.all([
    db.purchase.findMany({ where, select: { supplierId: true, day: true, dueOn: true, amountCentimes: true, paidCentimes: true } }),
    db.supplierPayment.groupBy({ by: ["supplierId"], where, _sum: { amountCentimes: true } }),
  ]);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const paid = new Map(payments.map((p) => [p.supplierId, p._sum.amountCentimes ?? 0n]));
  const bySupplier = Map.groupBy(purchases, (p) => p.supplierId);
  return [...bySupplier].flatMap(([supplierId, ps]) =>
    supplierDues(ps.map((p) => ({ day: day(p.day), dueOn: p.dueOn && day(p.dueOn), amountCentimes: p.amountCentimes, paidCentimes: p.paidCentimes })), paid.get(supplierId) ?? 0n),
  );
}

/**
 * For finance's budget (SPEC-finance FN15, §9 "Budget cash need"): the last `take` purchases of a kind of item, newest
 * first, each with its day and, bought on credit, the due day typed with it (none: paid at once, or due on its day).
 */
export async function lastPurchaseTerms(ctx: TenantContext, kind: string, take: number): Promise<{ day: string; dueOn: string | null }[]> {
  const where = { organizationId: ctx.organizationId };
  const items = await db.stockItem.findMany({ where: { ...where, kind }, select: { id: true } });
  const rows = await db.purchase.findMany({
    where: { ...where, stockItemId: { in: items.map((i) => i.id) } },
    orderBy: [{ day: "desc" }, { createdAt: "desc" }],
    take,
    select: { day: true, dueOn: true, amountCentimes: true, paidCentimes: true },
  });
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return rows.map((p) => ({ day: day(p.day), dueOn: p.dueOn && p.paidCentimes < p.amountCentimes ? day(p.dueOn) : null }));
}

/** For finance's export (SPEC-finance FN18): each purchase's or supplier payment's supplier name and farm, by id. */
export async function ledgerTagsOf(tx: Tx, ctx: TenantContext, ids: string[]) {
  const where = { organizationId: ctx.organizationId, id: { in: ids } };
  const debits = await tx.issuedDebit.findMany({ where, select: { id: true, instrumentId: true } }); // FN11: a debit's supplier is its instrument's
  const recordIds = { organizationId: ctx.organizationId, id: { in: [...ids, ...debits.map((d) => d.instrumentId)] } };
  const [purchases, payments] = await Promise.all([
    tx.purchase.findMany({ where: recordIds, select: { id: true, supplierId: true, farmId: true } }),
    tx.supplierPayment.findMany({ where: recordIds, select: { id: true, supplierId: true } }),
  ]);
  const records = [...purchases, ...payments.map((p) => ({ ...p, farmId: null }))];
  const byId = new Map(records.map((r) => [r.id, r]));
  const rows = [...records, ...debits.flatMap((d) => (byId.has(d.instrumentId) ? [{ ...byId.get(d.instrumentId)!, id: d.id }] : []))];
  const suppliers = await tx.supplier.findMany({ where: { organizationId: ctx.organizationId, id: { in: rows.map((r) => r.supplierId) } }, select: { id: true, name: true } });
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  return new Map(rows.map((r) => [r.id, { party: name.get(r.supplierId) ?? null, farmId: r.farmId, batchId: null }]));
}

/** For finance (SPEC-finance FN6, FN11): the issued cheques and bills debited after `after`, oldest first. */
export async function issuedDebitsChangedSince(tx: Tx, ctx: TenantContext, after: bigint, limit = 500) {
  const changes = await tx.change.findMany({
    where: { organizationId: ctx.organizationId, entity: "issuedDebit", version: { gt: after } },
    orderBy: { version: "asc" },
    take: limit,
  });
  const debits = changes.filter((c) => c.data !== null).map((c) => ({ version: c.version, d: c.data as unknown as IssuedDebitDto }));
  const issued = new Map((await issuedOfOrg(tx, ctx, debits.map((x) => x.d.instrumentId))).map((i) => [i.id, i]));
  const items = debits.flatMap(({ version, d }) => {
    const i = issued.get(d.instrumentId);
    return i ? [{ version, id: d.id, day: d.day as FarmDay, kind: i.kind, amountCentimes: i.amountCentimes }] : [];
  });
  return { items, readTo: changes.at(-1)?.version ?? after };
}

/** For finance's cash schedule (F-Effects): the issued bills the bank hasn't debited yet, by agreed date. */
export async function issuedBillsDue(ctx: TenantContext): Promise<{ dueOn: string; amountCentimes: bigint }[]> {
  return (await issuedOfOrg(db, ctx)).filter((i) => i.kind === "bill" && !i.debitedOn).map((i) => ({ dueOn: i.dueOn, amountCentimes: i.amountCentimes }));
}
