import { v7 as uuidv7 } from "uuid";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, latestRecordableDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities, placeNames } from "@/modules/farm-registry";
import { batchPlaces } from "@/modules/flock";
import { postEntry, type PostError } from "@/modules/finance/application/ledger";
import { treasuryKindOf } from "@/modules/finance/domain/assets";
import { checkPlacementPayment, placementDebt, placementPaymentPosting, type PlacementDebt } from "@/modules/finance/domain/placement-debt";
import { sourceAlreadyPosted } from "@/modules/finance/infrastructure/ledger";
import { PlacementPayment } from "@/modules/finance/schema";

export type PlacementPayError = PostError | "INVALID_INPUT" | "DAY_IN_FUTURE" | "NOTHING_OWED" | "PAID_MORE_THAN_OWED" | "TREASURY_ACCOUNT_MISMATCH";

const inFuture = (day: string, clock: Clock) => daysBetween(day as FarmDay, latestRecordableDay(clock)) < 0;
const PAYMENT = "placement:"; // source `placement:<batch>:pay:<payment>`, module finance
const paymentsOf = (batchId: string) => `${PAYMENT}${batchId}:pay:`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // a placement's source; `lay:<batch>` is FC6's transfer

/**
 * Each placement's debt, from finance's own entries: its purchase posted by FN7 (source `flock`, batch id) and the
 * payments posted for it. All placements when `batchIds` is absent.
 * ponytail: reads every placement entry of the organisation; filter by fiscal year if the list grows slow.
 */
async function debtsOf(tx: Tx, ctx: TenantContext, batchIds?: string[]): Promise<Map<string, PlacementDebt>> {
  const org = ctx.organizationId;
  const entries = (
    await tx.journalEntry.findMany({
      where: { organizationId: org, sourceModule: "flock", sourceId: batchIds ? { in: batchIds } : { not: null } },
      select: { id: true, sourceId: true, sourceVersion: true, lines: { select: { account: true, debitCentimes: true, creditCentimes: true } } },
    })
  ).filter((e) => UUID.test(e.sourceId!));
  const [reversals, payments] = await Promise.all([
    tx.journalEntry.findMany({ where: { organizationId: org, reversesId: { in: entries.map((e) => e.id) } }, select: { reversesId: true } }),
    tx.journalLine.findMany({
      where: { organizationId: org, debitCentimes: { gt: 0n }, entry: { sourceModule: "finance", OR: (batchIds?.map(paymentsOf) ?? [PAYMENT]).map((p) => ({ sourceId: { startsWith: p } })) } },
      select: { debitCentimes: true, entry: { select: { sourceId: true } } },
    }),
  ]);
  const reversed = new Set(reversals.map((r) => r.reversesId!));
  const paid = new Map<string, bigint>();
  for (const l of payments) {
    const id = l.entry.sourceId!.split(":")[1];
    paid.set(id, (paid.get(id) ?? 0n) + l.debitCentimes);
  }
  const byBatch = Map.groupBy(entries, (e) => e.sourceId!);
  const debts = new Map<string, PlacementDebt>();
  for (const [id, es] of byBatch) {
    const lines = (e: (typeof es)[number]) => e.lines.map((l) => ({ account: l.account, debit: l.debitCentimes, credit: l.creditCentimes }));
    const debt = placementDebt(es.map((e) => ({ id: e.id, version: e.sourceVersion ?? 0, lines: lines(e) })), reversed, paid.get(id) ?? 0n);
    if (debt) debts.set(id, debt);
  }
  return debts;
}

// A refused step rolls back what the transaction already wrote (as assets.ts).
const REFUSED = Symbol("refused");
export async function atomically<T, E extends string>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
  const outcome: { refused?: Result<T, E> } = {};
  try {
    return await db.$transaction(async (tx) => {
      const r = await work(tx);
      if (r.ok) return r;
      outcome.refused = r;
      throw REFUSED;
    });
  } catch (e) {
    if (e === REFUSED && outcome.refused) return outcome.refused;
    throw e;
  }
}

/**
 * SPEC-finance §9 "Placement debts": the owner or the manager pays a placement's chicks (D 4411) or point-of-lay hens
 * (FC6 classic: D 4481) / C 5161 or 5141, at most what is still owed for it. Online, audited. The id comes from the
 * form: the same form twice posts once (source `placement:<batch>:pay:<id>`). A `cash_book` entity posts it too: its
 * placement posted the debt on 4411, and the money leaving shows in its cash book, as a supplier payment's.
 */
export async function payPlacement(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<void, PlacementPayError>> {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  const parsed = PlacementPayment.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const p = parsed.data;
  if (inFuture(p.day, clock)) return fail("DAY_IN_FUTURE");
  const [entity] = await listLegalEntities(ctx);
  if (!entity) return fail("NOT_FOUND");
  const source = { module: "finance", id: `${paymentsOf(p.batchId)}${p.id}`, version: 1 };
  return atomically(async (tx): Promise<Result<void, PlacementPayError>> => {
    const batch = (await batchPlaces(tx, ctx, [p.batchId])).get(p.batchId);
    if (!batch) return fail("NOT_FOUND"); // another organisation's batch
    // Two payments of one placement at once: one after the other, so both are capped by the same debt.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${p.batchId}, 8))`;
    if (await sourceAlreadyPosted(tx, ctx, source)) return ok(undefined); // a retry
    const amount = BigInt(p.amountCentimes);
    const debt = checkPlacementPayment((await debtsOf(tx, ctx, [p.batchId])).get(p.batchId) ?? null, amount);
    if (!debt.ok) return debt;
    if (p.treasuryId) {
      const account = await tx.treasuryAccount.findFirst({ where: { id: p.treasuryId, organizationId: ctx.organizationId }, select: { kind: true } });
      if (!account) return fail("NOT_FOUND");
      if (account.kind !== treasuryKindOf(p.paidWith)) return fail("TREASURY_ACCOUNT_MISMATCH");
    }
    const posting = placementPaymentPosting(debt.value, amount, p.paidWith, p.treasuryId, batch.hatchery);
    const posted = await postEntry(tx, ctx, { id: uuidv7(), legalEntityId: entity.id, journal: posting.journal, day: p.day as FarmDay, label: posting.label, reversesId: null, lines: posting.lines, source });
    if (!posted.ok) return posted;
    await audit(tx, ctx, { entity: "PlacementDebt", entityId: p.batchId, action: "pay", after: { paymentId: p.id, day: p.day, amountCentimes: p.amountCentimes, paidWith: p.paidWith, treasuryId: p.treasuryId, account: debt.value.account } });
    return ok(undefined);
  });
}

export type PlacementToPay = { batchId: string; hatchery: string; place: string; placedOn: FarmDay; account: string; owed: bigint };

/** F-Effects: what each placement still owes, due on its placement day (the hatchery's terms aren't recorded). */
export async function placementDues(ctx: TenantContext): Promise<{ dueOn: string; amountCentimes: bigint }[]> {
  const debts = [...(await debtsOf(db, ctx))].filter(([, d]) => d.owed > 0n);
  const batches = await batchPlaces(db, ctx, debts.map(([id]) => id));
  return debts.flatMap(([id, d]) => { const b = batches.get(id); return b ? [{ dueOn: b.placedOn, amountCentimes: d.owed }] : []; });
}

/** The placements still owed, oldest first, with the hatchery's name as typed at placement (no supplier record). */
export async function placementsToPay(ctx: TenantContext): Promise<Result<PlacementToPay[], "FORBIDDEN">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN"); // the payer's list; the accountant reads it (SPEC-m5 PA5)
  const debts = [...(await debtsOf(db, ctx))].filter(([, d]) => d.owed > 0n);
  const batches = await batchPlaces(db, ctx, debts.map(([id]) => id));
  const names = await placeNames(db, ctx, [...batches.values()].flatMap((b) => [b.farmId, b.houseId]));
  return ok(
    debts
      .flatMap(([batchId, d]) => {
        const b = batches.get(batchId);
        const place = b && [b.farmId, b.houseId].flatMap((id) => names.get(id) ?? []).join(" · ");
        return b ? [{ batchId, hatchery: b.hatchery, place: place!, placedOn: b.placedOn, account: d.account, owed: d.owed }] : [];
      })
      .sort((a, b) => a.placedOn.localeCompare(b.placedOn)),
  );
}
