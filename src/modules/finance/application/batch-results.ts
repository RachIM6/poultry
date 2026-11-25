import { db, SYNC_TX, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { batchesForFinance, type BatchMoneyFacts } from "@/modules/flock";
import { batchConsumptions } from "@/modules/inventory";
import { salesByBatch } from "@/modules/sales";
import { payCosts } from "@/modules/workforce";
import { catchUpBooks } from "@/modules/finance/application/posting";
import { batchComparison, batchResult, monthPeriod, splitShared, type AllocationKey, type BatchComparison, type BatchResult } from "@/modules/finance/domain/batch";
import { hensConsumed, hensMethodOf } from "@/modules/finance/domain/hens";
import { PRODUCTION_EXPENSE_CATEGORIES } from "@/modules/finance/domain/production-cost";
import type { BatchResultDto } from "@/modules/finance/shared";

const day = (d: Date) => d.toISOString().slice(0, 10);

// farmId: a cost of one farm only (a pay month), shared over that farm's batches; absent, over all of them.
type SharedExpense = { id: string; amount: bigint; from: string; to: string; farmId?: string };

/** `asOf` (FC4): an expense dated on or before it, a pay month ended by then. `production` (FQ19): production categories only. */
const sharedExpenses = async (tx: Tx, ctx: TenantContext, asOf?: string, production = false): Promise<SharedExpense[]> => [
  ...(
    await tx.expense.findMany({
      where: { organizationId: ctx.organizationId, shared: true, ...(asOf && { day: { lte: new Date(`${asOf}T00:00:00Z`) } }), ...(production && { category: { in: PRODUCTION_EXPENSE_CATEGORIES } }) },
      orderBy: { id: "asc" },
    })
  ).map((e) => ({
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
function liveParts(key: AllocationKey, batches: BatchMoneyFacts[], frozen: Set<string>, expenses: SharedExpense[], frozenRows: { batchId: string; expenseId: string; amountCentimes: bigint }[]): Map<string, Split> {
  const taken = new Map<string, bigint>();
  for (const f of frozenRows) if (frozen.has(f.batchId)) taken.set(f.expenseId, (taken.get(f.expenseId) ?? 0n) + f.amountCentimes);
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
    const frozenRows = closing.length > 0 ? await tx.frozenAllocation.findMany({ where: { organizationId: ctx.organizationId } }) : [];
    for (const b of closing) {
      const parts = liveParts(key, batches, frozen, expenses, frozenRows);
      const rows = [...parts].flatMap(([expenseId, { parts: split }]) => (split.get(b.id) ? [{ organizationId: ctx.organizationId, batchId: b.id, expenseId, amountCentimes: split.get(b.id)! }] : []));
      await tx.frozenAllocation.createMany({ data: rows });
      frozenRows.push(...rows);
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
  // hens: a laying flock's entry value used up to the day (§9 "Laying hens in the batch result"), its chicks then 0;
  // transferred: a pullet batch's whole cost, negative, once transferred to lay: the layer batch carries it as its hens
  costs: { chicks: bigint; consumption: bigint; other: bigint; direct: bigint; allocated: bigint; hens: bigint; transferred: bigint };
  // a laying flock's hens (`hensConsumed`): basis "depreciation" with the owner's schedule (classic), else the entry value
  // of the birds gone, "pending" while a classic flock's schedule is untyped, "birdsGone" otherwise (simplified, cash
  // book, PCA off)
  hens: { basis: "depreciation" | "pending" | "birdsGone"; entry: bigint; depreciation: bigint; removed: bigint } | null;
  byBirdDays: boolean; // FN14: part of its live share was split by bird-days, no batch having any weight by the key
  costCentimes: bigint;
  comparison: BatchComparison; // FN13: mortality, FCR, feed price and price per kg, next to the result
};

/**
 * FN13: each batch's result, newest first: sales − (chicks + valued consumptions + T24's other costs, recorded before
 * FN13 and still counted (§9 "M1 other costs") + its direct expenses +
 * its share of the shared ones). A purchase is never a batch cost, only what was consumed (no double count). A laying
 * flock carries its hens' entry value used up to the day, not their price, and a pullet batch transferred to lay hands
 * its cost to the layer batch (§9 "Laying hens in the batch result"). `clock`: the day of an open flock, without `asOf`.
 * `asOf` (FC4, T109): as on that day, from the facts dated on or before it only. A batch closed by then keeps its
 * frozen shares; one still open then is given its share of what was left, by the key's weights known on that day.
 */
export async function batchResults(ctx: TenantContext, asOf?: FarmDay, clock: Clock = systemClock): Promise<Result<BatchResultRow[], "FORBIDDEN">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN"); // a read: the accountant too (SPEC-m5 PA5)
  await catchUpBooks(ctx); // §9: a batch that closed gets its shares frozen too
  // A read on the pool: an interactive transaction would hold a connection for all of it and, waiting for one under
  // load, fail the page (P2028). Postgres' READ COMMITTED gives each statement its own snapshot inside one anyway.
  return ok(await batchResultsIn(db, ctx, asOf, false, clock));
}

/** FN13 as text for the screens that show a batch's money (§9 "One cost per kg"): the report, the closing card, /compare. */
export async function batchResultDtos(ctx: TenantContext): Promise<Result<BatchResultDto[], "FORBIDDEN">> {
  const results = await batchResults(ctx);
  if (!results.ok) return results;
  const text = (c: bigint | null) => (c === null ? null : String(c));
  return ok(
    results.value.map((r) => ({
      id: r.id,
      salesCentimes: String(r.salesCentimes),
      costCentimes: String(r.costCentimes),
      marginCentimes: String(r.marginCentimes),
      soldGrams: r.soldGrams,
      costPerKgCentimes: text(r.costPerKgCentimes),
      marginPerKgCentimes: text(r.marginPerKgCentimes),
      marginPermille: text(r.marginPermille),
      hens: r.hens && { basis: r.hens.basis, centimes: String(r.costs.hens) },
      transferredCentimes: r.costs.transferred === 0n ? null : String(-r.costs.transferred),
    })),
  );
}

/**
 * FN13 inside the caller's transaction (the close run, FC4), or on `db` for a read. `production` (FC4, FQ19): only the
 * expenses of production categories count, directly or shared (PCA p. 43: no administration, financial or distribution
 * costs); the pay months always do.
 */
export async function batchResultsIn(tx: Tx, ctx: TenantContext, asOf?: FarmDay, production = false, clock: Clock = systemClock): Promise<BatchResultRow[]> {
  const batches = await batchesForFinance(tx, ctx, asOf);
  const sales = await salesByBatch(tx, ctx, asOf);
  const org = { organizationId: ctx.organizationId };
  const dated = asOf ? { day: { lte: new Date(`${asOf}T00:00:00Z`) } } : {};
  const categories = production ? { category: { in: PRODUCTION_EXPENSE_CATEGORIES } } : {};
  const direct = new Map(
    (await tx.expense.groupBy({ by: ["batchId"], where: { ...org, ...dated, ...categories, batchId: { not: null } }, _sum: { amountCentimes: true } })).map((d) => [d.batchId!, d._sum.amountCentimes ?? 0n]),
  );
  const expenses = await sharedExpenses(tx, ctx, asOf, production);
  const counted = new Set(expenses.map((e) => e.id));
  const closedBy = new Set(batches.filter((b) => b.closedOn !== null).map((b) => b.id)); // as of the day, if any
  const frozen = new Set((await tx.frozenBatch.findMany({ where: org, select: { batchId: true } })).map((f) => f.batchId).filter((id) => closedBy.has(id)));
  const allFrozen = await tx.frozenAllocation.findMany({ where: org });
  const frozenRows = allFrozen.filter((f) => frozen.has(f.batchId) && counted.has(f.expenseId));
  const [entity] = await listLegalEntities(ctx); // one per organisation, as keyOf
  const live = liveParts(entity?.allocationKey ?? "birdDays", batches, frozen, expenses, allFrozen);
  const allocatedTo = (id: string) =>
    frozen.has(id)
      ? frozenRows.filter((f) => f.batchId === id).reduce((s, f) => s + f.amountCentimes, 0n)
      : [...live.values()].reduce((s, split) => s + (split.parts.get(id) ?? 0n), 0n);

  const consumptions = await batchConsumptions(tx, ctx, batches.map((b) => b.id), asOf);
  // §9 "Laying hens in the batch result": the owner's laying period and cull value, when the books follow the classic method
  const classic = !!entity && hensMethodOf(entity.accountingProfile, entity.hensMethod) === "classic";
  const schedules = new Map(classic ? (await tx.hensSchedule.findMany({ where: { ...org, legalEntityId: entity.id } })).map((s) => [s.batchId, s]) : []);
  const to = asOf ?? farmDayOf(clock.now());
  const own = new Map(
    batches.map((b) => {
      const consumption = [...consumptions.get(b.id)!.values()].reduce((s, k) => s + k.centimes, 0n);
      return [b.id, { chicks: b.chicksCentimes, consumption, other: b.otherCentimes, direct: direct.get(b.id) ?? 0n, allocated: allocatedTo(b.id) }];
    }),
  );
  const whole = (id: string) => Object.values(own.get(id) ?? {}).reduce((s, c) => s + c, 0n);
  const transferred = new Set(batches.flatMap((b) => (b.species === "layer" && b.fromBatchId ? [b.fromBatchId] : []))); // by the day
  const rows: BatchResultRow[] = [];
  for (const b of [...batches].reverse()) {
    const feed = consumptions.get(b.id)!.get("feed") ?? { quantity: 0n, centimes: 0n };
    let hens: BatchResultRow["hens"] = null;
    if (b.species === "layer") {
      // bought: the placement's price, VAT included as the chicks' (FQ30); transferred: the pullet batch's whole cost
      const entry = b.fromBatchId ? whole(b.fromBatchId) : b.chicksCentimes;
      const s = schedules.get(b.id);
      const flock = { entry, entryDay: b.placedOn as FarmDay, started: b.started, onHand: b.onHand, out: b.out, sold: b.soldOut, closedOn: b.closedOn };
      hens = { basis: s ? "depreciation" : classic ? "pending" : "birdsGone", entry, ...hensConsumed(flock, s ? { lifeMonths: s.lifeMonths, cullValue: s.cullValueCentimes } : null, to) };
    }
    const costs = { ...own.get(b.id)!, ...(hens && { chicks: 0n }), hens: hens ? hens.depreciation + hens.removed : 0n, transferred: transferred.has(b.id) ? -whole(b.id) : 0n };
    const costCentimes = Object.values(costs).reduce((s, c) => s + c, 0n);
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
      hens,
      byBirdDays: !frozen.has(b.id) && [...live.values()].some((s) => s.byBirdDays && (s.parts.get(b.id) ?? 0n) > 0n),
      costCentimes,
      ...batchResult({ salesCentimes, costCentimes, soldGrams: BigInt(b.soldGrams) }),
      comparison: batchComparison({ started: b.started, lost: b.lost, eatenGrams: b.feedGrams, feedGrams: feed.quantity, feedCentimes: feed.centimes, soldGrams: BigInt(b.soldGrams), salesCentimes }),
    });
  }
  return rows;
}
