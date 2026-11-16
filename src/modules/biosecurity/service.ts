import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import {
  BIOSECURITY_MUTATIONS as M,
  RecordDisposal,
  RecordManure,
  RecordVisit,
  checkDisposal,
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
  },
  // No money in these logs: every member sees them.
  entities: {
    visit: (_ctx, data: VisitDto) => data,
    disposal: (_ctx, data: DisposalDto) => data,
    manureRemoval: (_ctx, data: ManureRemovalDto) => data,
  },
};
