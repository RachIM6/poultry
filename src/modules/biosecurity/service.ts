import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/kernel/result";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import { farmBelongsTo } from "@/modules/farm-registry";
import { BIOSECURITY_MUTATIONS as M, RecordVisit, visitZone, type VisitDto } from "@/modules/biosecurity/schema";

// SPEC-m2-compliance §4, light module: the logs a farm keeps on the phone, applied by POST /api/sync/push.
// Records are never deleted (D6): they are the evidence an inspection asks for.

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
  },
  entities: { visit: (_ctx, data: VisitDto) => data },
};
