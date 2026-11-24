import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
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
  type RegisterKeeper,
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
  doaClaimThresholdPermille: number | null;
  holderName: string | null;
  holderAddress: string | null;
  vetName: string | null;
  vetAddress: string | null;
  vetPhone: string | null;
  technicianName: string | null;
  chickImportApproval: string | null;
  registerKeepers: { name: string; position: string; fromOn: Date; toOn: Date | null }[];
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const date = (day: string) => new Date(`${day}T00:00:00Z`); // a calendar date

const farmDto = (r: FarmRow): FarmDto => ({
  id: r.id,
  name: r.name,
  region: r.region,
  province: r.province,
  commune: r.commune,
  gps: r.latitude === null || r.longitude === null ? null : { lat: r.latitude, lng: r.longitude },
  onssa: r.onssaNumber && r.onssaExpiresOn ? { number: r.onssaNumber, expiresOn: day(r.onssaExpiresOn) } : null,
  doaClaimThresholdPermille: r.doaClaimThresholdPermille,
  holder: r.holderName ? { name: r.holderName, address: r.holderAddress } : null,
  vet: r.vetName ? { name: r.vetName, address: r.vetAddress, phone: r.vetPhone } : null,
  technicianName: r.technicianName,
  chickImportApproval: r.chickImportApproval,
  registerKeepers: r.registerKeepers.map((k) => ({ name: k.name, position: k.position, from: day(k.fromOn), to: k.toOn && day(k.toOn) })),
});

// gps, onssa, holder and vet are one field each on the wire, several columns each in the table; the register keepers
// are rows of their own (saveKeepers).
function farmColumns(f: Partial<Omit<FarmFields, "registerKeepers">>) {
  const { gps, onssa, holder, vet, ...plain } = f;
  return {
    ...plain,
    ...(gps !== undefined && { latitude: gps?.lat ?? null, longitude: gps?.lng ?? null }),
    ...(onssa !== undefined && { onssaNumber: onssa?.number ?? null, onssaExpiresOn: onssa ? date(onssa.expiresOn) : null }),
    ...(holder !== undefined && { holderName: holder?.name ?? null, holderAddress: holder?.address ?? null }),
    ...(vet !== undefined && { vetName: vet?.name ?? null, vetAddress: vet?.address ?? null, vetPhone: vet?.phone ?? null }),
  };
}

/** The farm's register keepers, replaced as a whole list when the change carries one. */
async function saveKeepers(tx: Tx, ctx: TenantContext, farmId: string, keepers: RegisterKeeper[] | undefined) {
  if (keepers === undefined) return;
  await tx.registerKeeper.deleteMany({ where: { farmId, organizationId: ctx.organizationId } });
  await tx.registerKeeper.createMany({
    data: keepers.map((k, n) => ({ farmId, n, organizationId: ctx.organizationId, name: k.name, position: k.position, fromOn: date(k.from), toOn: k.to ? date(k.to) : null })),
  });
}

const houseDto = (r: HouseDto): HouseDto => ({ id: r.id, farmId: r.farmId, name: r.name, areaM2: r.areaM2, capacity: r.capacity, type: r.type });

const pick = <T extends object>(obj: T, keys: string[]) => Object.fromEntries(keys.map((k) => [k, obj[k as keyof T]]));

// Every lookup is scoped to the caller's organisation: another organisation's id is NOT_FOUND, never touched.
const ownFarm = (tx: Tx, ctx: TenantContext, id: string) => tx.farm.findFirst({ where: { id, organizationId: ctx.organizationId } });
const ownHouse = (tx: Tx, ctx: TenantContext, id: string) => tx.house.findFirst({ where: { id, organizationId: ctx.organizationId } });
const keepers = { registerKeepers: { orderBy: { n: "asc" as const } } };
const ownFarmDto = async (tx: Tx, ctx: TenantContext, id: string) => {
  const row = await tx.farm.findFirst({ where: { id, organizationId: ctx.organizationId }, include: keepers });
  return row && farmDto(row);
};

export const farmRegistrySync: SyncRegistry = {
  mutations: {
    [FARM_MUTATIONS.createFarm]: defineMutation({
      schema: CreateFarm,
      action: "farms.manage",
      async apply(tx, ctx, { id, registerKeepers, ...fields }, meta) {
        if (await tx.farm.findUnique({ where: { id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        const { name, region, province, commune } = fields;
        const data = { ...farmColumns(fields), id, organizationId: ctx.organizationId, name, region, province, commune };
        await tx.farm.create({ data });
        await saveKeepers(tx, ctx, id, registerKeepers);
        const dto = (await ownFarmDto(tx, ctx, id))!;
        await recordChange(tx, ctx, "farm", id, dto);
        await audit(tx, ctx, { entity: "Farm", entityId: id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    // Last write received wins, field by field; the overwritten values stay in the audit log (ADR-003 §5, SPEC X2).
    [FARM_MUTATIONS.updateFarm]: defineMutation({
      schema: UpdateFarm,
      action: "farms.manage",
      async apply(tx, ctx, { id, changes }, meta) {
        const before = await ownFarmDto(tx, ctx, id);
        if (!before) return fail("NOT_FOUND");
        const { registerKeepers, ...columns } = changes;
        await tx.farm.update({ where: { id }, data: farmColumns(columns) });
        await saveKeepers(tx, ctx, id, registerKeepers);
        const dto = (await ownFarmDto(tx, ctx, id))!;
        await recordChange(tx, ctx, "farm", id, dto);
        await audit(tx, ctx, { entity: "Farm", entityId: id, action: "update", before: pick(before, Object.keys(changes)), after: changes, ...meta });
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
        await audit(tx, ctx, { entity: "House", entityId: id, action: "create", after: dto, ...meta });
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
        await audit(tx, ctx, { entity: "House", entityId: id, action: "update", before: pick(houseDto(row), Object.keys(changes)), after: changes, ...meta });
        return ok(undefined);
      },
    }),
  },
  // No money in farms or houses: every member sees them as they are.
  entities: { farm: (_ctx, data: FarmDto) => data, house: (_ctx, data: HouseDto) => data },
};

/** For other modules writing farm data: is this farm the caller's organisation's? Inside their transaction. */
export const farmBelongsTo = async (tx: Tx, ctx: TenantContext, farmId: string) => (await ownFarm(tx, ctx, farmId)) !== null;

/** For other modules: the caller's organisation's house and its farm, or null. Inside their transaction. */
export const houseOf = async (tx: Tx, ctx: TenantContext, houseId: string) => {
  const house = await ownHouse(tx, ctx, houseId);
  return house && { id: house.id, farmId: house.farmId, name: house.name, areaM2: house.areaM2 };
};

/** For other modules: the caller's organisation's houses among `ids`, by id (another organisation's are left out). */
export async function housesOf(tx: Tx, ctx: TenantContext, ids: string[]) {
  const rows = await tx.house.findMany({ where: { organizationId: ctx.organizationId, id: { in: ids } }, select: { id: true, farmId: true, name: true, areaM2: true } });
  return new Map(rows.map((h) => [h.id, h]));
}

/** For finance's export (SPEC-finance FN18): the names of the caller's organisation's farms and houses, by id. */
export async function placeNames(tx: Tx, ctx: TenantContext, ids: string[]) {
  const where = { organizationId: ctx.organizationId, id: { in: ids } };
  const [farms, houses] = await Promise.all([tx.farm.findMany({ where, select: { id: true, name: true } }), tx.house.findMany({ where, select: { id: true, name: true } })]);
  return new Map([...farms, ...houses].map((x) => [x.id, x.name]));
}

/** For finance's asset register (SPEC-finance FC1): the caller's organisation's farms, each with its houses, by name. */
export const farmsWithHouses = (ctx: TenantContext) =>
  db.farm.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, name: true, houses: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });

/**
 * For the scheduler (SPEC-m2-compliance DC4), across organisations: farms whose ONSSA authorization expires on or
 * before `day`. Read-only; callers notify each farm's own organisation.
 */
export async function onssaAuthorizationsDueBy(day: string) {
  const rows = await db.farm.findMany({
    where: { onssaNumber: { not: null }, onssaExpiresOn: { lte: new Date(`${day}T00:00:00Z`) } },
    select: { id: true, organizationId: true, onssaNumber: true, onssaExpiresOn: true },
  });
  return rows.map((r) => ({ subjectId: r.id, organizationId: r.organizationId, title: r.onssaNumber!, expiresOn: r.onssaExpiresOn!.toISOString().slice(0, 10) }));
}
