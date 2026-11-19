import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { batchFacts } from "@/modules/flock";
import { batchHasPlan, savePlan } from "@/modules/health/infrastructure/vaccinations";
import { planFor, type PlanVaccinations } from "@/modules/health/schema";
import { areVaccines, ownProtocol } from "@/modules/reference-data";

/**
 * SPEC H1, applied by the sync push right after the placement: the batch's plan from the farm's protocol, as the phone
 * built it. One plan per batch; the lines keep the protocol as it was, whatever edits come later.
 */
export async function planBatchVaccinations(
  tx: Tx,
  ctx: TenantContext,
  cmd: z.infer<typeof PlanVaccinations>,
  meta: { mutationId: string; deviceCreatedAt: Date },
) {
  const batch = await batchFacts(tx, ctx, cmd.batchId);
  if (!batch || !(await ownProtocol(tx, ctx, cmd.protocolId))) return fail("NOT_FOUND");
  if (batch.status !== "open") return fail("BATCH_CLOSED");
  if (!(await areVaccines(tx, cmd.items.map((i) => i.productId)))) return fail("INVALID_INPUT");
  if (await batchHasPlan(tx, ctx, cmd.batchId)) return fail("ALREADY_EXISTS");

  const plan = planFor(cmd.batchId, batch.placedOn, cmd.items);
  await savePlan(tx, ctx, cmd.protocolId, plan);
  for (const v of plan) await recordChange(tx, ctx, "vaccination", v.id, v);
  await audit(tx, ctx, { entity: "VaccinationPlan", entityId: cmd.batchId, action: "create", after: { protocolId: cmd.protocolId, items: cmd.items }, ...meta });
  return ok(undefined);
}
