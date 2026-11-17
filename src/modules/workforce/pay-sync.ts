import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import { RecordAdvance, WORKFORCE_MUTATIONS as M, type AdvanceDto } from "@/modules/workforce/schema";

// SPEC-m4 WF10–WF12: advances and pay. Money: owners and managers only, never sent to workers (SPEC I5).

export const paySync: SyncRegistry = {
  mutations: {
    [M.recordAdvance]: defineMutation({
      schema: RecordAdvance,
      action: "workforce.manage",
      async apply(tx, ctx, a, meta) {
        const employee = await tx.employee.findFirst({ where: { id: a.employeeId, organizationId: ctx.organizationId }, select: { farmId: true } });
        if (!employee) return fail("NOT_FOUND");
        if (await tx.salaryAdvance.findUnique({ where: { id: a.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        await tx.salaryAdvance.create({ data: { ...a, day: new Date(`${a.day}T00:00:00Z`), amountCentimes: BigInt(a.amountCentimes), farmId: employee.farmId, organizationId: ctx.organizationId, recordedBy: ctx.userId } });
        const dto: AdvanceDto = { ...a, farmId: employee.farmId };
        await recordChange(tx, ctx, "advance", a.id, dto);
        await audit(tx, ctx, { entity: "SalaryAdvance", entityId: a.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
  },
  // A worker's phone receives no advance at all, theirs included (W-Staff "Droits").
  entities: { advance: (ctx, data: AdvanceDto) => (can(ctx, "money.read") ? data : undefined) },
};
