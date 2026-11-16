import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { checkCollection } from "@/modules/eggs/domain/collection";
import { collectionIdTaken, findCollection, saveCorrection, saveNewCollection } from "@/modules/eggs/infrastructure/collections";
import type { CorrectCollection, EggCollectionDto, RecordCollection } from "@/modules/eggs/schema";
import { batchFacts } from "@/modules/flock";

type Meta = { mutationId: string; deviceCreatedAt: Date };
const todayOf = (clock: Clock) => nextFarmDay(farmDayOf(clock.now())); // a phone's clock may run a little ahead

/** SPEC-m3 E1, applied by the sync push: one collection of a layer batch (several a day). */
export async function recordCollection(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof RecordCollection>, meta: Meta, clock: Clock = systemClock) {
  const batch = await batchFacts(tx, ctx, cmd.batchId);
  if (!batch) return fail("NOT_FOUND");
  if (await collectionIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  const checked = checkCollection(batch, cmd.day as FarmDay, cmd.counts, cmd.sample, todayOf(clock));
  if (!checked.ok) return checked;

  const dto: EggCollectionDto = cmd;
  await saveNewCollection(tx, ctx, batch.farmId, dto, ctx.userId);
  await recordChange(tx, ctx, "eggCollection", dto.id, dto);
  await audit(tx, ctx, { entity: "EggCollection", entityId: dto.id, action: "create", after: dto, ...meta });
  return ok(undefined);
}

/** SPEC-m3 E1: a collection corrected while its batch is open; the counts it replaces stay in the audit log. */
export async function correctCollection(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof CorrectCollection>, meta: Meta, clock: Clock = systemClock) {
  const previous = await findCollection(tx, ctx, cmd.id);
  const batch = previous && (await batchFacts(tx, ctx, previous.batchId));
  if (!previous || !batch) return fail("NOT_FOUND");
  const checked = checkCollection(batch, previous.day as FarmDay, cmd.counts, cmd.sample, todayOf(clock));
  if (!checked.ok) return checked;

  const dto: EggCollectionDto = { id: previous.id, batchId: previous.batchId, day: previous.day, counts: cmd.counts, sample: cmd.sample };
  await saveCorrection(tx, dto);
  await recordChange(tx, ctx, "eggCollection", dto.id, dto);
  await audit(tx, ctx, {
    entity: "EggCollection",
    entityId: dto.id,
    action: "update",
    before: { counts: previous.counts, sample: previous.sample },
    after: { counts: dto.counts, sample: dto.sample },
    ...meta,
  });
  return ok(undefined);
}
