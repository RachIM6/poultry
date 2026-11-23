import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { areEggGrades } from "@/modules/reference-data";
import { checkCollection } from "@/modules/eggs/domain/collection";
import { checkDiscard, checkGrading, eggLots } from "@/modules/eggs/domain/stock";
import {
  collectionIdTaken,
  discardIdTaken,
  eggFlowsOf,
  findCollection,
  gradingIdTaken,
  lockEggs,
  saveCorrection,
  saveDiscard,
  saveGrading,
  saveNewCollection,
} from "@/modules/eggs/infrastructure/collections";
import type { CorrectCollection, DiscardEggs, EggCollectionDto, EggDiscardDto, EggGradingDto, GradeEggs, RecordCollection } from "@/modules/eggs/schema";
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
  // E2: a correction can't take back eggs already graded, discarded or sold from that day.
  await lockEggs(tx, dto.batchId);
  const flows = await eggFlowsOf(tx, ctx, dto.batchId);
  const after = eggLots({ ...flows, collections: flows.collections.map((c) => (c.id === dto.id ? dto : c)) });
  if (after.some((l) => l.eggs < 0)) return fail("NOT_ENOUGH_EGGS");
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

/** Grading and discards apply to a layer batch's eggs, open or closed: eggs stay in stock after the hens are sold. */
async function layerBatch(tx: Tx, ctx: TenantContext, batchId: string) {
  const batch = await batchFacts(tx, ctx, batchId);
  return batch && batch.species === "layer" ? batch : null;
}

/** SPEC-m3 E3, applied by the sync push: a laying day's ungraded eggs sorted into grade classes. */
export async function gradeEggs(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof GradeEggs>, meta: Meta) {
  const batch = await layerBatch(tx, ctx, cmd.batchId);
  if (!batch) return fail("NOT_FOUND");
  if (await gradingIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  if (!(await areEggGrades(tx, Object.keys(cmd.grades)))) return fail("INVALID_INPUT"); // a grade the reference data doesn't have
  await lockEggs(tx, cmd.batchId);
  const checked = checkGrading(eggLots(await eggFlowsOf(tx, ctx, cmd.batchId)), cmd);
  if (!checked.ok) return checked;
  const dto: EggGradingDto = cmd;
  await saveGrading(tx, ctx, batch.farmId, dto);
  await recordChange(tx, ctx, "eggGrading", dto.id, dto);
  await audit(tx, ctx, { entity: "EggGrading", entityId: dto.id, action: "create", after: dto, ...meta });
  return ok(undefined);
}

/** SPEC-m3 E3, applied by the sync push: eggs of a lot thrown away, with the reason, on the phone's farm day. */
export async function discardEggs(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof DiscardEggs>, meta: Meta, clock: Clock = systemClock) {
  // A phone from before `day` was sent (rollout): the server's farm day, as discards were counted until then, never
  // before the lot's laying day (a phone a little ahead may have collected "tomorrow").
  const serverDay = farmDayOf(clock.now());
  const day = cmd.day ?? (serverDay < cmd.laidOn ? cmd.laidOn : serverDay);
  if (daysBetween(day as FarmDay, todayOf(clock)) < 0) return fail("DAY_IN_FUTURE");
  if (day < cmd.laidOn) return fail("INVALID_INPUT"); // eggs can't be thrown away before they were laid
  const batch = await layerBatch(tx, ctx, cmd.batchId);
  if (!batch) return fail("NOT_FOUND");
  if (await discardIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  await lockEggs(tx, cmd.batchId);
  const checked = checkDiscard(eggLots(await eggFlowsOf(tx, ctx, cmd.batchId)), cmd);
  if (!checked.ok) return checked;
  const dto: EggDiscardDto = { ...cmd, day };
  await saveDiscard(tx, ctx, batch.farmId, dto);
  await recordChange(tx, ctx, "eggDiscard", dto.id, dto);
  await audit(tx, ctx, { entity: "EggDiscard", entityId: dto.id, action: "create", after: dto, ...meta });
  return ok(undefined);
}
