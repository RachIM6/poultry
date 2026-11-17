import { audit } from "@/lib/audit";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import { checkBands } from "@/modules/climate/domain/targets";
import { CLIMATE_MUTATIONS as M, RecordReading, SaveTargets, type ReadingDto, type TargetSet } from "@/modules/climate/schema";
import { houseOf } from "@/modules/flock";

const clock: Clock = systemClock;

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
    // CL2: anyone on the farm records a house's climate, offline; once per id.
    [M.recordReading]: defineMutation({
      schema: RecordReading,
      action: "climate.record",
      async apply(tx, ctx, r, meta) {
        const house = await houseOf(tx, ctx, r.houseId);
        if (!house) return fail("NOT_FOUND");
        if (r.day > farmDayOf(clock.now())) return fail("DAY_IN_FUTURE");
        if (await tx.climateReading.findUnique({ where: { id: r.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        const dto: ReadingDto = { ...r, farmId: house.farmId, byUserId: ctx.userId };
        await tx.climateReading.create({ data: { ...dto, day: new Date(`${r.day}T00:00:00Z`), organizationId: ctx.organizationId } });
        await recordChange(tx, ctx, "climateReading", r.id, dto);
        await audit(tx, ctx, { entity: "ClimateReading", entityId: r.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
  },
  // Every member sees the targets: the reading screen judges against them offline.
  entities: { climateTargets: (_ctx, data: TargetSet) => data, climateReading: (_ctx, data: ReadingDto) => data },
};
