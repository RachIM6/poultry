import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import {
  BIOSECURITY_MUTATIONS as M,
  RecordCleanoutStep,
  RecordDisposal,
  RecordManure,
  RecordVisit,
  SetMinDowntime,
  StartCleanout,
  checkDisposal,
  checkStep,
  type CleanoutDto,
  type CleanoutStepKey,
  type DowntimeSettingDto,
  visitZone,
  type DisposalDto,
  type ManureRemovalDto,
  type VisitDto,
} from "@/modules/biosecurity/schema";
import { farmBelongsTo, houseOf } from "@/modules/farm-registry";
import { batchFacts } from "@/modules/flock";

// SPEC-m2-compliance §4, light module: the logs a farm keeps on the phone, applied by POST /api/sync/push.
// Records are never deleted (D6): they are the evidence an inspection asks for.

const day = (d: string) => new Date(`${d}T00:00:00Z`); // a calendar date
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** The clean-out as the phone stores it: header and steps in one record. */
async function cleanoutDto(tx: Tx, id: string): Promise<CleanoutDto> {
  const c = await tx.cleanout.findUniqueOrThrow({ where: { id }, include: { steps: { orderBy: { id: "asc" } } } });
  return {
    id: c.id,
    farmId: c.farmId,
    houseId: c.houseId,
    afterBatchId: c.afterBatchId,
    startedOn: dayOf(c.startedOn),
    steps: c.steps.map((s) => ({ id: s.id, step: s.step as CleanoutStepKey, day: dayOf(s.day), product: s.product, dose: s.dose, productLot: s.productLot, note: s.note })),
  };
}

/** The farm, and the house and batch when given, are the caller's organisation's and belong together. */
async function placeOf(tx: Tx, ctx: TenantContext, r: { farmId: string; houseId?: string | null; batchId?: string | null }): Promise<Result<void>> {
  if (!(await farmBelongsTo(tx, ctx, r.farmId))) return fail("NOT_FOUND");
  if (r.houseId && (await houseOf(tx, ctx, r.houseId))?.farmId !== r.farmId) return fail("NOT_FOUND");
  if (r.batchId && (await batchFacts(tx, ctx, r.batchId))?.farmId !== r.farmId) return fail("NOT_FOUND");
  return ok(undefined);
}

export const biosecuritySync: SyncRegistry = {
  mutations: {
    [M.recordVisit]: defineMutation({
      schema: RecordVisit,
      action: "biosecurity.record",
      async apply(tx, ctx, { id, farmId, enteredAt, ...fields }, meta) {
        if (!(await farmBelongsTo(tx, ctx, farmId))) return fail("NOT_FOUND");
        const zone = visitZone(fields);
        if (!zone.ok) return zone;
        if (await tx.visit.findUnique({ where: { id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        await tx.visit.create({ data: { id, organizationId: ctx.organizationId, farmId, enteredAt: new Date(enteredAt), ...fields, recordedBy: ctx.userId } });
        const dto: VisitDto = { id, farmId, enteredAt, ...fields };
        await recordChange(tx, ctx, "visit", id, dto);
        await audit(tx, ctx, { entity: "Visit", entityId: id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    [M.recordDisposal]: defineMutation({
      schema: RecordDisposal,
      action: "biosecurity.record",
      async apply(tx, ctx, dto: DisposalDto, meta) {
        const place = await placeOf(tx, ctx, dto);
        if (!place.ok) return place;
        const checked = checkDisposal(dto);
        if (!checked.ok) return checked;
        if (await tx.disposal.findUnique({ where: { id: dto.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        await tx.disposal.create({ data: { ...dto, organizationId: ctx.organizationId, day: day(dto.day), recordedBy: ctx.userId } });
        await recordChange(tx, ctx, "disposal", dto.id, dto);
        await audit(tx, ctx, { entity: "Disposal", entityId: dto.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    [M.recordManure]: defineMutation({
      schema: RecordManure,
      action: "biosecurity.record",
      async apply(tx, ctx, dto: ManureRemovalDto, meta) {
        const place = await placeOf(tx, ctx, dto);
        if (!place.ok) return place;
        if (await tx.manureRemoval.findUnique({ where: { id: dto.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        await tx.manureRemoval.create({ data: { ...dto, organizationId: ctx.organizationId, day: day(dto.day), recordedBy: ctx.userId } });
        await recordChange(tx, ctx, "manureRemoval", dto.id, dto);
        await audit(tx, ctx, { entity: "ManureRemoval", entityId: dto.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    // BS4: after the house's batch has closed, once per batch.
    [M.startCleanout]: defineMutation({
      schema: StartCleanout,
      action: "biosecurity.record",
      async apply(tx, ctx, { id, houseId, afterBatchId, startedOn }, meta) {
        const house = await houseOf(tx, ctx, houseId);
        const batch = await batchFacts(tx, ctx, afterBatchId);
        if (!house || !batch || batch.farmId !== house.farmId) return fail("NOT_FOUND");
        if (batch.status !== "closed") return fail("BATCH_NOT_CLOSED");
        if (await tx.cleanout.findFirst({ where: { OR: [{ id }, { afterBatchId }] }, select: { id: true } })) return fail("CLEANOUT_ALREADY_STARTED");
        await tx.cleanout.create({ data: { id, organizationId: ctx.organizationId, farmId: house.farmId, houseId, afterBatchId, startedOn: day(startedOn), startedBy: ctx.userId } });
        const dto = await cleanoutDto(tx, id);
        await recordChange(tx, ctx, "cleanout", id, dto);
        await audit(tx, ctx, { entity: "Cleanout", entityId: id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    [M.recordCleanoutStep]: defineMutation({
      schema: RecordCleanoutStep,
      action: "biosecurity.record",
      async apply(tx, ctx, { cleanoutId, ...step }, meta) {
        if (!(await tx.cleanout.findFirst({ where: { id: cleanoutId, organizationId: ctx.organizationId }, select: { id: true } }))) return fail("NOT_FOUND");
        const before = await cleanoutDto(tx, cleanoutId);
        const checked = checkStep(before.steps, step);
        if (!checked.ok) return checked;
        await tx.cleanoutStep.create({ data: { ...step, cleanoutId, day: day(step.day), recordedBy: ctx.userId } });
        await recordChange(tx, ctx, "cleanout", cleanoutId, await cleanoutDto(tx, cleanoutId));
        await audit(tx, ctx, { entity: "CleanoutStep", entityId: step.id, action: "create", after: { cleanoutId, ...step }, ...meta });
        return ok(undefined);
      },
    }),
    // BS5: a farm setting, so the farm's managers set it, like the farm itself.
    [M.setMinDowntime]: defineMutation({
      schema: SetMinDowntime,
      action: "farms.manage",
      async apply(tx, ctx, { farmId, minDays }, meta) {
        if (!(await farmBelongsTo(tx, ctx, farmId))) return fail("NOT_FOUND");
        const before = await tx.downtimeSetting.findUnique({ where: { farmId } });
        await tx.downtimeSetting.upsert({ where: { farmId }, create: { farmId, organizationId: ctx.organizationId, minDays }, update: { minDays } });
        const dto: DowntimeSettingDto = { id: farmId, farmId, minDays };
        await recordChange(tx, ctx, "downtimeSetting", farmId, dto);
        await audit(tx, ctx, { entity: "DowntimeSetting", entityId: farmId, action: "update", before: before && { minDays: before.minDays }, after: { minDays }, ...meta });
        return ok(undefined);
      },
    }),
  },
  // No money in these logs: every member sees them.
  entities: {
    visit: (_ctx, data: VisitDto) => data,
    disposal: (_ctx, data: DisposalDto) => data,
    manureRemoval: (_ctx, data: ManureRemovalDto) => data,
    cleanout: (_ctx, data: CleanoutDto) => data,
    downtimeSetting: (_ctx, data: DowntimeSettingDto) => data,
  },
};
