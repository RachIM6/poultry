import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/kernel/result";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import { checkBands } from "@/modules/climate/domain/targets";
import { CLIMATE_MUTATIONS as M, SaveTargets, type TargetSet } from "@/modules/climate/schema";

// SPEC-m4 §5: climate targets, readings and power cuts, written offline. Light module: Prisma and rules here; the
// rules the phone runs too (targets, verdicts) are in domain/.

export const climateSync: SyncRegistry = {
  mutations: {
    // CL1, §2: the owner enters the targets from a source; each save is a new dated version.
    [M.saveTargets]: defineMutation({
      schema: SaveTargets,
      action: "climate.manage",
      async apply(tx, ctx, set, meta) {
        const bands = checkBands(set.bands);
        if (!bands.ok) return bands;
        if (await tx.climateTargetSet.findUnique({ where: { id: set.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        await tx.climateTargetSet.create({ data: { ...set, validFrom: new Date(`${set.validFrom}T00:00:00Z`), organizationId: ctx.organizationId, createdBy: ctx.userId } });
        const dto: TargetSet = set;
        await recordChange(tx, ctx, "climateTargets", set.id, dto);
        await audit(tx, ctx, { entity: "ClimateTargetSet", entityId: set.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
  },
  // Every member sees the targets: the reading screen judges against them offline.
  entities: { climateTargets: (_ctx, data: TargetSet) => data },
};
