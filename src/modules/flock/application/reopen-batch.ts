import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { checkReopen } from "@/modules/flock/domain/reopen";
import { batchesOfHouse, closingOf, loadBatch, lockHouse, saveReopening } from "@/modules/flock/infrastructure/batches";
import type { ReopenBatch } from "@/modules/flock/schema";

type Meta = { mutationId: string; deviceCreatedAt: Date };

/**
 * SPEC B6 "Reopening", applied by the sync push under the batch's and its house's locks: the closed batch opens again
 * (its house is occupied again), its closing's figures cleared and audited with the owner's reason. Finance's part (the
 * period lock, the frozen shares) is chained in the app's sync registry: flock may not call finance.
 */
export async function reopenBatch(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof ReopenBatch>, meta: Meta) {
  const batch = await loadBatch(tx, ctx, cmd.batchId);
  const closing = batch && (await closingOf(tx, ctx, cmd.batchId));
  if (!batch || !closing) return fail("NOT_FOUND");
  const p = batch.placement;
  await lockHouse(tx, p.houseId); // as a placement: no batch joins the house meanwhile
  const checked = checkReopen({ ...p, status: batch.status, ...closing }, await batchesOfHouse(tx, ctx, p.houseId));
  if (!checked.ok) return checked;
  const reopened = batch.reopen();
  if (!reopened.ok) return reopened;
  const dto = await saveReopening(tx, batch);
  await recordChange(tx, ctx, "batch", dto.id, dto);
  const before = { status: "closed", ...closing, costCentimes: closing.costCentimes?.toString() ?? null, costPerKgCentimes: closing.costPerKgCentimes?.toString() ?? null };
  await audit(tx, ctx, { entity: "Batch", entityId: dto.id, action: "reopen", before, after: { status: "open", reason: cmd.reason }, ...meta });
  return ok(undefined);
}
