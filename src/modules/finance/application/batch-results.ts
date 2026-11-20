import { db, type Tx } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { batchesForFinance, type BatchMoneyFacts } from "@/modules/flock";
import { batchConsumptionCost } from "@/modules/inventory";
import { salesByBatch } from "@/modules/sales";
import { payCosts } from "@/modules/workforce";
import { allocate, batchResult, birdDays, monthPeriod, type BatchResult } from "@/modules/finance/domain/batch";

const day = (d: Date) => d.toISOString().slice(0, 10);

// farmId: a cost of one farm only (a pay month), shared over that farm's batches; absent, over all of them.
type SharedExpense = { id: string; amount: bigint; from: string; to: string; farmId?: string };

const sharedExpenses = async (tx: Tx, ctx: TenantContext): Promise<SharedExpense[]> => [
  ...(await tx.expense.findMany({ where: { organizationId: ctx.organizationId, shared: true }, orderBy: { id: "asc" } })).map((e) => ({
    id: e.id,
    amount: e.amountCentimes,
    from: day(e.serviceFrom!),
    to: day(e.serviceTo!),
  })),
  // plan-m4 "Later": a validated month's labour cost, shared by bird-days like any common charge of the month
  ...(await payCosts(tx, ctx)).map((p) => ({ id: p.id, amount: p.costCentimes, ...monthPeriod(p.month), farmId: p.farmId })),
];

const weightOver = (b: BatchMoneyFacts, e: SharedExpense) =>
  e.farmId && e.farmId !== b.farmId ? 0n : birdDays({ placedOn: b.placedOn, lastDay: b.closedOn, started: b.started, out: b.out, from: e.from, to: e.to });

/**
 * FN14: each shared expense's parts for the batches not yet frozen: what's left of it after the frozen shares, split
 * by bird-days over its service period (largest remainder, so the parts and the frozen shares sum to the expense).
 */
async function liveParts(tx: Tx, ctx: TenantContext, batches: BatchMoneyFacts[], frozen: Set<string>): Promise<Map<string, Map<string, bigint>>> {
  const expenses = await sharedExpenses(tx, ctx);
  const frozenSums = await tx.frozenAllocation.groupBy({ by: ["expenseId"], where: { organizationId: ctx.organizationId }, _sum: { amountCentimes: true } });
  const taken = new Map(frozenSums.map((f) => [f.expenseId, f._sum.amountCentimes ?? 0n]));
  const open = batches.filter((b) => !frozen.has(b.id));
  return new Map(expenses.map((e) => [e.id, allocate(e.amount - (taken.get(e.id) ?? 0n), open.map((b) => ({ id: b.id, weight: weightOver(b, e) })))]));
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
    for (const b of closing) {
      const parts = await liveParts(tx, ctx, batches, frozen);
      const rows = [...parts].flatMap(([expenseId, split]) => (split.get(b.id) ? [{ organizationId: ctx.organizationId, batchId: b.id, expenseId, amountCentimes: split.get(b.id)! }] : []));
      await tx.frozenAllocation.createMany({ data: rows });
      await tx.frozenBatch.create({ data: { batchId: b.id, organizationId: ctx.organizationId } });
      frozen.add(b.id);
    }
    return closing.length;
  });
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
  costCentimes: bigint;
};

/**
 * FN13: each batch's result, newest first: sales − (chicks + valued consumptions + other costs + its direct expenses +
 * its share of the shared ones). A purchase is never a batch cost, only what was consumed (no double count).
 */
export async function batchResults(ctx: TenantContext): Promise<Result<BatchResultRow[], "FORBIDDEN">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN"); // a read: the accountant too (SPEC-m5 PA5)
  return ok(
    await db.$transaction(async (tx) => {
      const batches = await batchesForFinance(tx, ctx);
      const sales = await salesByBatch(tx, ctx);
      const org = { organizationId: ctx.organizationId };
      const direct = new Map(
        (await tx.expense.groupBy({ by: ["batchId"], where: { ...org, batchId: { not: null } }, _sum: { amountCentimes: true } })).map((d) => [d.batchId!, d._sum.amountCentimes ?? 0n]),
      );
      const frozenRows = await tx.frozenAllocation.findMany({ where: org });
      const frozen = new Set((await tx.frozenBatch.findMany({ where: org, select: { batchId: true } })).map((f) => f.batchId));
      const live = await liveParts(tx, ctx, batches, frozen);
      const allocatedTo = (id: string) =>
        frozen.has(id)
          ? frozenRows.filter((f) => f.batchId === id).reduce((s, f) => s + f.amountCentimes, 0n)
          : [...live.values()].reduce((s, split) => s + (split.get(id) ?? 0n), 0n);

      const rows: BatchResultRow[] = [];
      for (const b of [...batches].reverse()) {
        const costs = { chicks: b.chicksCentimes, consumption: await batchConsumptionCost(tx, ctx, b.id), other: b.otherCentimes, direct: direct.get(b.id) ?? 0n, allocated: allocatedTo(b.id) };
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
          costCentimes,
          ...batchResult({ salesCentimes, costCentimes, soldGrams: BigInt(b.soldGrams) }),
        });
      }
      return rows;
    }),
  );
}
