import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import type { TenantContext } from "@/lib/tenant";
import { legalEntityIn, listLegalEntities } from "@/modules/farm-registry";
import { batchFacts } from "@/modules/flock";
import { fiscalYearOf, monthOf } from "@/modules/finance/domain/entry";
import { lockedMonths, yearClose } from "@/modules/finance/infrastructure/ledger";

type Meta = { mutationId: string; deviceCreatedAt: Date };

/**
 * SPEC B6 "Reopening", finance's part, in the sync push's transaction before flock reopens the batch (the app's
 * registry chains them). Refused while its closing's month is locked (FN5) or its fiscal year closed (FCX6): those
 * books never change this way. Its frozen shares (FN14) are released, audited, so its allocation is computed again
 * while it is open (FN13) and frozen anew after its next closing. A closing posts no entry (FN7): nothing to reverse
 * here; the corrections that follow (a sale cancelled, an expense) post their own reversals.
 */
export async function reopenBatchBooks(tx: Tx, ctx: TenantContext, batchId: string, meta: Meta): Promise<Result<void, "PERIOD_LOCKED" | "YEAR_CLOSED">> {
  const batch = await batchFacts(tx, ctx, batchId);
  if (!batch?.closedOn) return ok(undefined); // not found or not closed: flock refuses it
  const [first] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation (postPending)
  const entity = first && (await legalEntityIn(tx, ctx, first.id)); // row-locked: no month locked, no year closed meanwhile
  if (entity) {
    if (await yearClose(tx, ctx, entity.id, fiscalYearOf(batch.closedOn, entity.fiscalYearStartMonth).to)) return fail("YEAR_CLOSED");
    if ((await lockedMonths(tx, ctx, entity.id)).has(monthOf(batch.closedOn))) return fail("PERIOD_LOCKED");
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.organizationId}, 7))`; // freezeClosedBatches' lock
  const where = { organizationId: ctx.organizationId, batchId };
  const shares = await tx.frozenAllocation.findMany({ where, select: { expenseId: true, amountCentimes: true }, orderBy: { expenseId: "asc" } });
  const { count } = await tx.frozenBatch.deleteMany({ where });
  if (count === 0) return ok(undefined); // closed since the last freeze: nothing frozen yet
  await tx.frozenAllocation.deleteMany({ where });
  const before = { shares: shares.map((s) => ({ expenseId: s.expenseId, amountCentimes: String(s.amountCentimes) })) };
  await audit(tx, ctx, { entity: "FrozenBatch", entityId: batchId, action: "unfreeze", before, ...meta });
  return ok(undefined);
}
