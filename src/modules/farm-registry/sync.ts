import type { Tx } from "@/lib/db";
import { fail, ok } from "@/lib/kernel/result";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import {
  CreateFarm,
  CreateHouse,
  FARM_MUTATIONS,
  UpdateFarm,
  UpdateHouse,
  type FarmDto,
  type FarmFields,
  type HouseDto,
} from "@/modules/farm-registry/schema";

// Offline writes of farms and houses (SPEC F4), applied by POST /api/sync/push. Light module: Prisma and rules here.

type FarmRow = {
  id: string;
  name: string;
  region: string;
  province: string;
  commune: string;
  latitude: number | null;
  longitude: number | null;
  onssaNumber: string | null;
  onssaExpiresOn: Date | null;
};

const farmDto = (r: FarmRow): FarmDto => ({
  id: r.id,
  name: r.name,
  region: r.region,
  province: r.province,
  commune: r.commune,
  gps: r.latitude === null || r.longitude === null ? null : { lat: r.latitude, lng: r.longitude },
  onssa: r.onssaNumber && r.onssaExpiresOn ? { number: r.onssaNumber, expiresOn: r.onssaExpiresOn.toISOString().slice(0, 10) } : null,
});

// gps and onssa are one field each on the wire, two columns each in the table.
function farmColumns(f: Partial<FarmFields>) {
  const { gps, onssa, ...plain } = f;
  return {
    ...plain,
    ...(gps !== undefined && { latitude: gps?.lat ?? null, longitude: gps?.lng ?? null }),
    ...(onssa !== undefined && {
      onssaNumber: onssa?.number ?? null,
      onssaExpiresOn: onssa ? new Date(`${onssa.expiresOn}T00:00:00Z`) : null, // a calendar date
    }),
  };
}

const houseDto = (r: HouseDto): HouseDto => ({ id: r.id, farmId: r.farmId, name: r.name, areaM2: r.areaM2, capacity: r.capacity, type: r.type });

const pick = <T extends object>(obj: T, keys: string[]) => Object.fromEntries(keys.map((k) => [k, obj[k as keyof T]]));

type Meta = { mutationId: string; deviceCreatedAt: Date };
const audit = (tx: Tx, ctx: TenantContext, meta: Meta, entity: string, entityId: string, action: string, before: object | null, after: object) =>
  tx.auditEvent.create({
    data: { organizationId: ctx.organizationId, userId: ctx.userId, entity, entityId, action, before: before ?? undefined, after, ...meta },
  });

// Every lookup is scoped to the caller's organisation: another organisation's id is NOT_FOUND, never touched.
const ownFarm = (tx: Tx, ctx: TenantContext, id: string) => tx.farm.findFirst({ where: { id, organizationId: ctx.organizationId } });
const ownHouse = (tx: Tx, ctx: TenantContext, id: string) => tx.house.findFirst({ where: { id, organizationId: ctx.organizationId } });

export const farmRegistrySync: SyncRegistry = {
  mutations: {
    [FARM_MUTATIONS.createFarm]: defineMutation({
      schema: CreateFarm,
      action: "farms.manage",
      async apply(tx, ctx, { id, ...fields }, meta) {
        if (await tx.farm.findUnique({ where: { id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        const { name, region, province, commune } = fields;
        const data = { ...farmColumns(fields), id, organizationId: ctx.organizationId, name, region, province, commune };
        const dto = farmDto(await tx.farm.create({ data }));
        await recordChange(tx, ctx, "farm", id, dto);
        await audit(tx, ctx, meta, "Farm", id, "create", null, dto);
        return ok(undefined);
      },
    }),
    // Last write received wins, field by field; the overwritten values stay in the audit log (ADR-003 §5, SPEC X2).
    [FARM_MUTATIONS.updateFarm]: defineMutation({
      schema: UpdateFarm,
      action: "farms.manage",
      async apply(tx, ctx, { id, changes }, meta) {
        const row = await ownFarm(tx, ctx, id);
        if (!row) return fail("NOT_FOUND");
        const dto = farmDto(await tx.farm.update({ where: { id }, data: farmColumns(changes) }));
        await recordChange(tx, ctx, "farm", id, dto);
        await audit(tx, ctx, meta, "Farm", id, "update", pick(farmDto(row), Object.keys(changes)), changes);
        return ok(undefined);
      },
    }),
    [FARM_MUTATIONS.createHouse]: defineMutation({
      schema: CreateHouse,
      action: "farms.manage",
      async apply(tx, ctx, { id, farmId, ...fields }, meta) {
        if (!(await ownFarm(tx, ctx, farmId))) return fail("NOT_FOUND");
        if (await tx.house.findUnique({ where: { id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        const dto = houseDto(await tx.house.create({ data: { id, farmId, organizationId: ctx.organizationId, ...fields } }));
        await recordChange(tx, ctx, "house", id, dto);
        await audit(tx, ctx, meta, "House", id, "create", null, dto);
        return ok(undefined);
      },
    }),
    [FARM_MUTATIONS.updateHouse]: defineMutation({
      schema: UpdateHouse,
      action: "farms.manage",
      async apply(tx, ctx, { id, changes }, meta) {
        const row = await ownHouse(tx, ctx, id);
        if (!row) return fail("NOT_FOUND");
        const dto = houseDto(await tx.house.update({ where: { id }, data: changes }));
        await recordChange(tx, ctx, "house", id, dto);
        await audit(tx, ctx, meta, "House", id, "update", pick(houseDto(row), Object.keys(changes)), changes);
        return ok(undefined);
      },
    }),
  },
  // No money in farms or houses: every member sees them as they are.
  entities: { farm: (_ctx, data: FarmDto) => data, house: (_ctx, data: HouseDto) => data },
};
