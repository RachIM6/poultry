import { audit } from "@/lib/audit";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, farmDayOf, farmMinutesOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import { checkBands, outOfRange, targetFor, verdicts } from "@/modules/climate/domain/targets";
import { CLIMATE_MUTATIONS as M, EndPowerCut, RecordReading, SaveTargets, StartPowerCut, type Band, type PowerCutDto, type ReadingDto, type TargetSet } from "@/modules/climate/schema";
import { batchPlacedInHouseOn, farmBelongsTo, houseOf } from "@/modules/flock";
import { notify } from "@/modules/notifications";

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
        // CL4: out of the owner's targets for the age of the house's batch that day → owners and managers, urgently.
        const placedOn = await batchPlacedInHouseOn(tx, ctx, r.houseId, r.day);
        if (placedOn) {
          const age = daysBetween(placedOn, r.day as FarmDay);
          const sets = (await tx.climateTargetSet.findMany({ where: { organizationId: ctx.organizationId } })).map(
            (s): TargetSet => ({ id: s.id, validFrom: s.validFrom.toISOString().slice(0, 10), source: s.source, bands: s.bands as Band[] }),
          );
          if (outOfRange(verdicts(r, targetFor(sets, r.day, age)))) {
            const values = [`${(r.temperatureTenths / 10).toFixed(1).replace(".", ",")} °C`, `${r.humidity} %`, ...(r.ammonia === null ? [] : [`${r.ammonia} ppm`])].join(" · ");
            await notify(tx, ctx, { roles: ["owner", "manager"], templateKey: "climateOutOfRange", params: { house: house.name, age: String(age), values }, urgency: "urgent" });
          }
        }
        await recordChange(tx, ctx, "climateReading", r.id, dto);
        await audit(tx, ctx, { entity: "ClimateReading", entityId: r.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    // CL5: anyone starts a power cut ("Coupure de courant"); one open cut per farm; owners and managers are told at once.
    [M.startPowerCut]: defineMutation({
      schema: StartPowerCut,
      action: "climate.record",
      async apply(tx, ctx, c, meta) {
        if (!(await farmBelongsTo(tx, ctx, c.farmId))) return fail("NOT_FOUND");
        if (await tx.powerCut.findUnique({ where: { id: c.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        if (await tx.powerCut.count({ where: { farmId: c.farmId, endedAt: null } })) return fail("POWER_CUT_OPEN");
        const startedAt = new Date(c.startedAt);
        await tx.powerCut.create({ data: { id: c.id, farmId: c.farmId, startedAt, organizationId: ctx.organizationId, byUserId: ctx.userId } });
        const dto: PowerCutDto = { id: c.id, farmId: c.farmId, startedAt: startedAt.toISOString(), endedAt: null, generatorStarted: null, generatorSeconds: null, dieselMl: null };
        await recordChange(tx, ctx, "powerCut", c.id, dto);
        await audit(tx, ctx, { entity: "PowerCut", entityId: c.id, action: "create", after: dto, ...meta });
        const minutes = farmMinutesOf(startedAt);
        const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
        await notify(tx, ctx, { roles: ["owner", "manager"], templateKey: "powerCut", params: { time }, urgency: "urgent" });
        return ok(undefined);
      },
    }),
    [M.endPowerCut]: defineMutation({
      schema: EndPowerCut,
      action: "climate.record",
      async apply(tx, ctx, e, meta) {
        const row = await tx.powerCut.findFirst({ where: { id: e.id, organizationId: ctx.organizationId } });
        if (!row) return fail("NOT_FOUND");
        if (row.endedAt) return fail("ALREADY_DONE");
        const endedAt = new Date(e.endedAt);
        if (endedAt < row.startedAt) return fail("CUT_END_BEFORE_START");
        const generator = { generatorStarted: e.generatorStarted, generatorSeconds: e.generatorSeconds, dieselMl: e.dieselMl };
        await tx.powerCut.update({ where: { id: e.id }, data: { endedAt, ...generator } });
        const dto: PowerCutDto = { id: row.id, farmId: row.farmId, startedAt: row.startedAt.toISOString(), endedAt: endedAt.toISOString(), ...generator };
        await recordChange(tx, ctx, "powerCut", row.id, dto);
        await audit(tx, ctx, { entity: "PowerCut", entityId: row.id, action: "end", after: dto, ...meta });
        return ok(undefined);
      },
    }),
  },
  // Every member sees the targets: the reading screen judges against them offline.
  entities: { climateTargets: (_ctx, data: TargetSet) => data, climateReading: (_ctx, data: ReadingDto) => data, powerCut: (_ctx, data: PowerCutDto) => data },
};
