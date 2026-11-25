import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmRegistrySync } from "@/modules/farm-registry";
import { FARM_MUTATIONS } from "@/modules/farm-registry/schema";
import { flockSync as registry } from "@/modules/flock";
import { FLOCK_MUTATIONS as M, type BatchDto } from "@/modules/flock/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-20T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const today = farmDayOf(new Date());
const placedOn = addFarmDays(today, -10);
const placement = (id: string, houseId: string, over: Record<string, unknown> = {}) => ({
  id,
  houseId,
  strainId: "ross-308",
  placedOn,
  chicksPlaced: 10_000,
  deadOnArrival: 30,
  hatchery: "Couvoir Atlas",
  deliveryNote: "BL-1",
  chickUnitPriceCentimes: "500",
  chickVatCentimes: "5000",
  dayOldWeightGrams: 42,
  ...over,
});
const correct = (batchId: string, changes: Record<string, unknown>) => m(M.correctPlacement, { batchId, changes });
const latest = async (ctx: TenantContext, id: string) => (await pull(ctx, 0, registry)).changes.filter((c) => c.entity === "batch" && c.id === id).at(-1)?.data as BatchDto;

describe("correcting a placement (SPEC B1)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), other: uuidv7(), h1: uuidv7(), h2: uuidv7(), h3: uuidv7(), far: uuidv7(), batch: uuidv7(), busy: uuidv7(), fresh: uuidv7() };

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.createMany({ data: [{ id: "ross-308", name: "Ross 308" }, { id: "cobb-500", name: "Cobb 500" }, { id: "isa-brown", name: "ISA Brown", productionTypes: ["pullet", "layer"] }] });
    const farm = (id: string) => m(FARM_MUTATIONS.createFarm, { id, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null });
    const house = (id: string, farmId: string) => m(FARM_MUTATIONS.createHouse, { id, farmId, name: "B", areaM2: 1200, capacity: 12000, type: "closed" });
    await push(a, [farm(ids.farm), farm(ids.other), house(ids.h1, ids.farm), house(ids.h2, ids.farm), house(ids.h3, ids.farm), house(ids.far, ids.other)], farmRegistrySync);
    expect(
      await statuses(a, [
        m(M.placeBatch, placement(ids.batch, ids.h1)),
        m(M.placeBatch, placement(ids.busy, ids.h2)),
        m(M.placeBatch, placement(ids.fresh, ids.h3)),
        m(M.recordDay, { batchId: ids.batch, day: addFarmDays(placedOn, 2), changes: { dead: 40, culled: 10 } }),
      ]),
    ).toEqual(["applied", "applied", "applied", "applied"]);
  });

  it("corrects the typed figures, republishes the batch and audits before / after", async () => {
    const fix = correct(ids.batch, { chicksPlaced: 9_800, freeChicks: 200, deadOnArrival: 20, chickUnitPriceCentimes: "520", chickVatCentimes: null, hatchery: "Couvoir Souss", deliveryNote: "BL-2", strainId: "cobb-500", placedOn: addFarmDays(placedOn, -1) });
    expect(await statuses(a, [fix])).toEqual(["applied"]);
    expect(await statuses(a, [fix])).toEqual(["applied"]); // the same mutation again: its stored result
    expect(await latest(a, ids.batch)).toMatchObject({
      chicksPlaced: 9_800,
      freeChicks: 200,
      deadOnArrival: 20,
      chickUnitPriceCentimes: "520",
      chickVatCentimes: null,
      hatchery: "Couvoir Souss",
      deliveryNote: "BL-2",
      strainId: "cobb-500",
      placedOn: addFarmDays(placedOn, -1),
      houseId: ids.h1,
      dayOldWeightGrams: 42, // untouched
      status: "open",
    });
    const audits = await db.auditEvent.findMany({ where: { organizationId: a.organizationId, entity: "Batch", entityId: ids.batch, action: "update" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].before).toEqual({ chicksPlaced: 10_000, freeChicks: 0, deadOnArrival: 30, chickUnitPriceCentimes: "500", chickVatCentimes: "5000", hatchery: "Couvoir Atlas", deliveryNote: "BL-1", strainId: "ross-308", placedOn });
    expect(audits[0].after).toMatchObject({ chicksPlaced: 9_800, chickVatCentimes: null });
    expect(audits[0].mutationId).toBe(fix.id);
  });

  it("keeps money from workers when it republishes the batch", async () => {
    const worker = { ...a, role: "worker" as const };
    const seen = await latest(worker, ids.batch);
    expect(seen.chicksPlaced).toBe(9_800);
    expect(seen).not.toHaveProperty("chickUnitPriceCentimes");
    expect(seen).not.toHaveProperty("chickVatCentimes");
  });

  it("is the owner's and the manager's, in their own organisation", async () => {
    const worker = { ...a, role: "worker" as const };
    const manager = { ...a, role: "manager" as const };
    expect(await statuses(worker, [correct(ids.batch, { hatchery: "X" })])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(b, [correct(ids.batch, { hatchery: "X" })])).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(manager, [correct(ids.batch, { hatchery: "Couvoir du Nord" })])).toEqual(["applied"]);
    expect((await db.batch.findUniqueOrThrow({ where: { id: ids.batch } })).hatchery).toBe("Couvoir du Nord");
  });

  it("is bounded by what the batch recorded and checked as a new placement", async () => {
    const before = await db.batch.findUniqueOrThrow({ where: { id: ids.batch } });
    expect(
      await statuses(a, [
        correct(ids.batch, { placedOn: addFarmDays(placedOn, 3) }), // after the first daily entry
        correct(ids.batch, { chicksPlaced: 69 }), // 69 + 200 free − 20 dead on arrival: 249 started, 50 gone
        correct(ids.batch, { chicksPlaced: 1, freeChicks: 0, deadOnArrival: 0 }), // 1 bird started, 50 already gone
        correct(ids.batch, { houseId: ids.h3 }), // data recorded: the house stays
        correct(ids.batch, { deadOnArrival: 20_000 }),
        correct(ids.batch, { placedOn: addFarmDays(today, 3) }),
        correct(ids.batch, { strainId: "isa-brown" }), // not a broiler strain (R5)
        correct(ids.batch, {}),
      ]),
    ).toEqual(["errors.PLACEMENT_AFTER_DATA", "applied", "errors.FEWER_BIRDS_THAN_RECORDED", "errors.BATCH_HAS_DATA", "errors.DEAD_ON_ARRIVAL_TOO_HIGH", "errors.PLACEMENT_IN_FUTURE", "errors.INVALID_INPUT", "errors.INVALID_INPUT"]);
    expect(await statuses(a, [correct(ids.batch, { chicksPlaced: before.chicksPlaced })])).toEqual(["applied"]); // back as it was
  });

  it("moves a batch with no data yet to a free house of its farm, never into an occupied one or another farm", async () => {
    expect(await statuses(a, [correct(ids.fresh, { houseId: ids.h2 })])).toEqual(["errors.HOUSE_HAS_OPEN_BATCH"]);
    expect(await statuses(a, [correct(ids.fresh, { houseId: ids.far })])).toEqual(["errors.INVALID_INPUT"]);
    expect(await statuses(a, [correct(ids.fresh, { houseId: uuidv7() })])).toEqual(["errors.NOT_FOUND"]);
    // h1's batch closes, then the fresh batch moves into h1: not before h1's previous batch left
    expect(await statuses(a, [m(M.closeBatch, { batchId: ids.batch, day: addFarmDays(placedOn, 5), reason: "Fin" })])).toEqual(["applied"]);
    expect(await statuses(a, [correct(ids.fresh, { houseId: ids.h1 })])).toEqual(["errors.PLACEMENT_OVERLAPS_PREVIOUS"]); // placed on day 0, h1 emptied on day 5
    expect(await statuses(a, [correct(ids.fresh, { houseId: ids.h1, placedOn: addFarmDays(placedOn, 5) })])).toEqual(["applied"]);
    expect(await db.batch.findUniqueOrThrow({ where: { id: ids.fresh } })).toMatchObject({ houseId: ids.h1, farmId: ids.farm });
  });

  it("refuses a closed batch and a batch made by a transfer to lay", async () => {
    expect(await statuses(a, [correct(ids.batch, { hatchery: "X" })])).toEqual(["errors.BATCH_CLOSED"]);
    const [pullets, hens] = [uuidv7(), uuidv7()];
    expect(
      await statuses(a, [
        m(M.placeBatch, placement(pullets, ids.h3, { species: "pullet", strainId: "isa-brown", chickVatCentimes: null })),
        m(M.transferToLaying, { batchId: pullets, day: today, newBatchId: hens, houseId: ids.h3, hens: 9_000 }),
        correct(hens, { hatchery: "X" }),
      ]),
    ).toEqual(["applied", "applied", "errors.INVALID_INPUT"]);
  });
});
