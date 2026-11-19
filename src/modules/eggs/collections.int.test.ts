import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { EGG_MUTATIONS as M, eggsIn, type EggCollectionDto } from "@/modules/eggs/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-16T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const counts = (normal: number) => ({ normal, cracked: 10, dirty: 5, doubleYolk: 2, floor: 3, broken: 1 });

describe("egg collections (SPEC-m3 E1)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), pullets: uuidv7(), layers: uuidv7() };
  const day = farmDayOf(new Date());

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "lohmann-brown", name: "Lohmann Brown", productionTypes: ["pullet", "layer"] } });
    const place = (id: string, houseId: string, species: string) =>
      m("flock.placeBatch", { id, houseId, species, strainId: "lohmann-brown", placedOn: day, chicksPlaced: 6000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 126 });
    const house2 = uuidv7();
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "P1", areaM2: 1000, capacity: 6000, type: "closed" }),
        m("farm-registry.createHouse", { id: house2, farmId: ids.farm, name: "P2", areaM2: 1000, capacity: 6000, type: "closed" }),
        place(ids.layers, ids.house, "layer"),
        place(ids.pullets, house2, "pullet"),
      ),
    ).toEqual(Array(5).fill("applied"));
  });

  it("takes several collections a day from workers; their total is the day's eggs", async () => {
    const worker = { ...a, role: "worker" as const };
    const collect = (normal: number) => m(M.recordCollection, { id: uuidv7(), batchId: ids.layers, day, counts: counts(normal), sample: null });
    expect(await statuses(worker, collect(1500), collect(1642), collect(1200))).toEqual(["applied", "applied", "applied"]);
    const pulled = (await pull(a, 0, registry)).changes.filter((c) => c.entity === "eggCollection").map((c) => c.data as EggCollectionDto);
    expect(pulled.reduce((n, c) => n + eggsIn(c.counts), 0)).toBe(1500 + 1642 + 1200 + 3 * 21);
  });

  it("corrects a collection while the batch is open, the old counts in the audit log", async () => {
    const id = uuidv7();
    await statuses(a, m(M.recordCollection, { id, batchId: ids.layers, day, counts: counts(1000), sample: null }));
    expect(await statuses(a, m(M.correctCollection, { id, counts: counts(1100), sample: { count: 30, grams: 1854 } }))).toEqual(["applied"]);
    const last = (await pull(a, 0, registry)).changes.findLast((c) => c.id === id)?.data as EggCollectionDto;
    expect(last).toMatchObject({ counts: { normal: 1100 }, sample: { count: 30, grams: 1854 }, day });
    const audited = await db.auditEvent.findFirstOrThrow({ where: { entity: "EggCollection", entityId: id, action: "update" } });
    expect(audited).toMatchObject({ before: { counts: { normal: 1000 } }, after: { counts: { normal: 1100 } } });

    expect(await statuses(b, m(M.correctCollection, { id, counts: counts(1), sample: null }))).toEqual(["errors.NOT_FOUND"]); // another organisation
    await db.batch.update({ where: { id: ids.layers }, data: { status: "closed" } });
    expect(await statuses(a, m(M.correctCollection, { id, counts: counts(1), sample: null }))).toEqual(["errors.BATCH_CLOSED"]);
    await db.batch.update({ where: { id: ids.layers }, data: { status: "open" } });
  });

  it("refuses eggs from a batch that doesn't lay, or another organisation's", async () => {
    const collect = (batchId: string) => m(M.recordCollection, { id: uuidv7(), batchId, day, counts: counts(10), sample: null });
    expect(await statuses(a, collect(ids.pullets))).toEqual(["errors.INVALID_INPUT"]);
    expect(await statuses(b, collect(ids.layers))).toEqual(["errors.NOT_FOUND"]);
    expect((await pull(b, 0, registry)).changes.filter((c) => c.entity === "eggCollection")).toEqual([]);
  });
});
