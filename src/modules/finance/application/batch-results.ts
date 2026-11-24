import { db, SYNC_TX, type Tx } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { batchesForFinance, type BatchMoneyFacts } from "@/modules/flock";
import { batchConsumption } from "@/modules/inventory";
import { salesByBatch } from "@/modules/sales";
import { payCosts } from "@/modules/workforce";
import { batchComparison, batchResult, monthPeriod, splitShared, type AllocationKey, type BatchComparison, type BatchResult } from "@/modules/finance/domain/batch";

const day = (d: Date) => d.toISOString().slice(0, 10);

// farmId: a cost of one farm only (a pay month), shared over that farm's batches; absent, over all of them.
type SharedExpense = { id: string; amount: bigint; from: string; to: string; farmId?: string };

/** `asOf` (FC4): an expense dated on or before it, a pay month ended by then. */
const sharedExpenses = async (tx: Tx, ctx: TenantContext, asOf?: string): Promise<SharedExpense[]> => [
  ...(await tx.expense.findMany({ where: { organizationId: ctx.organizationId, shared: true, ...(asOf && { day: { lte: new Date(`${asOf}T00:00:00Z`) } }) }, orderBy: { id: "asc" } })).map((e) => ({
    id: e.id,
    amount: e.amountCentimes,
    from: day(e.serviceFrom!),
    to: day(e.serviceTo!),
  })),
  // plan-m4 "Later": a validated month's labour cost, shared by the key like any common charge of the month
  ...(await payCosts(tx, ctx)).map((p) => ({ id: p.id, amount: p.costCentimes, ...monthPeriod(p.month), farmId: p.farmId })).filter((p) => !asOf || p.to <= asOf),
];

const factsOver = (b: BatchMoneyFacts, e: SharedExpense) =>
  e.farmId && e.farmId !== b.farmId ? null : { placedOn: b.placedOn, lastDay: b.closedOn, started: b.started, out: b.out, areaM2: b.houseAreaM2, soldOut: b.soldOut, from: e.from, to: e.to };

/** FN14: the entity's key (one legal entity per organisation, as in postPending). */
const keyOf = async (ctx: TenantContext): Promise<AllocationKey> => (await listLegalEntities(ctx))[0]?.allocationKey ?? "birdDays";

type Split = ReturnType<typeof splitShared>;

/**
 * FN14: each shared expense's parts for the batches not yet frozen: what's left of it after the frozen shares, split
 * by the entity's key over its service period (largest remainder, so the parts and the frozen shares sum to the expense).
 */
async function liveParts(tx: Tx, ctx: TenantContext, key: AllocationKey, batches: BatchMoneyFacts[], frozen: Set<string>, expenses: SharedExpense[]): Promise<Map<string, Split>> {
  const frozenSums = await tx.frozenAllocation.groupBy({ by: ["expenseId"], where: { organizationId: ctx.organizationId, batchId: { in: [...frozen] } }, _sum: { amountCentimes: true } });
  const taken = new Map(frozenSums.map((f) => [f.expenseId, f._sum.amountCentimes ?? 0n]));
  const open = batches.filter((b) => !frozen.has(b.id));
  return new Map(expenses.map((e) => [e.id, splitShared(e.amount - (taken.get(e.id) ?? 0n), key, open.map((b) => ({ id: b.id, facts: factsOver(b, e) })))]));
}

/**
 * FN14: freezes the allocation of every closed batch not frozen yet: its share of each shared expense is stored and
 * never computed again, whatever happens to the key's inputs or to later expenses. Runs after each sync push (with
 * the posting pipeline), so a batch is frozen soon after it closes.
 */
export async function freezeClosedBatches(ctx: TenantContext): Promise<number> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.organizationId}, 7))`; // one freezer per organisation
    const batches = await batchesForFinance(tx, ctx);
    const frozen = new Set((await tx.frozenBatch.findMany({ where: { organizationId: ctx.organizationId }, select: { batchId: true } })).map((f) => f.batchId));
    const closing = batches.filter((b) => b.status === "closed" && !frozen.has(b.id));
    const expenses = await sharedExpenses(tx, ctx);
    const key = await keyOf(ctx);
    for (const b of closing) {
      const parts = await liveParts(tx, ctx, key, batches, frozen, expenses);
      const rows = [...parts].flatMap(([expenseId, { parts: split }]) => (split.get(b.id) ? [{ organizationId: ctx.organizationId, batchId: b.id, expenseId, amountCentimes: split.get(b.id)! }] : []));
      await tx.frozenAllocation.createMany({ data: rows });
      await tx.frozenBatch.create({ data: { batchId: b.id, organizationId: ctx.organizationId } });
      frozen.add(b.id);
    }
    return closing.length;
  }, SYNC_TX); // waiting for the organisation's lock counts too
}

export type BatchResultRow = BatchResult & {
  id: string;
  houseName: string;
  placedOn: string;
  closedOn: string | null;
  frozen: boolean;
  soldGrams: number;
  salesCentimes: bigint;
  costs: { chicks: bigint; consumption: bigint; other: bigint; direct: bigint; allocated: bigint };
  byBirdDays: boolean; // FN14: part of its live share was split by bird-days, no batch having any weight by the key
  costCentimes: bigint;
  comparison: BatchComparison; // FN13: mortality, FCR, feed price and price per kg, next to the result
};

/**
 * FN13: each batch's result, newest first: sales − (chicks + valued consumptions + other costs + its direct expenses +
 * its share of the shared ones). A purchase is never a batch cost, only what was consumed (no double count).
 * `asOf` (FC4, T109): as on that day, from the facts dated on or before it only. A batch closed by then keeps its
 * frozen shares; one still open then is given its share of what was left, by the key's weights known on that day.
 */
export async function batchResults(ctx: TenantContext, asOf?: FarmDay): Promise<Result<BatchResultRow[], "FORBIDDEN">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN"); // a read: the accountant too (SPEC-m5 PA5)
  return ok(await db.$transaction((tx) => batchResultsIn(tx, ctx, asOf)));
}

/** FN13 inside the caller's transaction (the close run, FC4). */
export async function batchResultsIn(tx: Tx, ctx: TenantContext, asOf?: FarmDay): Promise<BatchResultRow[]> {
  const batches = await batchesForFinance(tx, ctx, asOf);
  const sales = await salesByBatch(tx, ctx, asOf);
  const org = { organizationId: ctx.organizationId };
  const dated = asOf ? { day: { lte: new Date(`${asOf}T00:00:00Z`) } } : {};
  const direct = new Map(
    (await tx.expense.groupBy({ by: ["batchId"], where: { ...org, ...dated, batchId: { not: null } }, _sum: { amountCentimes: true } })).map((d) => [d.batchId!, d._sum.amountCentimes ?? 0n]),
  );
  const expenses = await sharedExpenses(tx, ctx, asOf);
  const counted = new Set(expenses.map((e) => e.id));
  const closedBy = new Set(batches.filter((b) => b.closedOn !== null).map((b) => b.id)); // as of the day, if any
  const frozen = new Set((await tx.frozenBatch.findMany({ where: org, select: { batchId: true } })).map((f) => f.batchId).filter((id) => closedBy.has(id)));
  const frozenRows = (await tx.frozenAllocation.findMany({ where: org })).filter((f) => frozen.has(f.batchId) && counted.has(f.expenseId));
  const live = await liveParts(tx, ctx, await keyOf(ctx), batches, frozen, expenses);
  const allocatedTo = (id: string) =>
    frozen.has(id)
      ? frozenRows.filter((f) => f.batchId === id).reduce((s, f) => s + f.amountCentimes, 0n)
      : [...live.values()].reduce((s, split) => s + (split.parts.get(id) ?? 0n), 0n);

  const rows: BatchResultRow[] = [];
  for (const b of [...batches].reverse()) {
    const consumed = await batchConsumption(tx, ctx, b.id, asOf);
    const consumption = [...consumed.values()].reduce((s, k) => s + k.centimes, 0n);
    const feed = consumed.get("feed") ?? { quantity: 0n, centimes: 0n };
    const costs = { chicks: b.chicksCentimes, consumption, other: b.otherCentimes, direct: direct.get(b.id) ?? 0n, allocated: allocatedTo(b.id) };
    const costCentimes = costs.chicks + costs.consumption + costs.other + costs.direct + costs.allocated;
    const salesCentimes = sales.get(b.id) ?? 0n;
    rows.push({
      id: b.id,
      houseName: b.houseName,
      placedOn: b.placedOn,
      closedOn: b.closedOn,
      frozen: frozen.has(b.id),
      soldGrams: b.soldGrams,
      salesCentimes,
      costs,
      byBirdDays: !frozen.has(b.id) && [...live.values()].some((s) => s.byBirdDays && (s.parts.get(b.id) ?? 0n) > 0n),
      costCentimes,
      ...batchResult({ salesCentimes, costCentimes, soldGrams: BigInt(b.soldGrams) }),
      comparison: batchComparison({ started: b.started, lost: b.lost, feedGrams: feed.quantity, feedCentimes: feed.centimes, soldGrams: BigInt(b.soldGrams), salesCentimes }),
    });
  }
  return rows;
}
