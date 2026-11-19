import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmRegistrySync } from "@/modules/farm-registry";
import { FARM_MUTATIONS } from "@/modules/farm-registry/schema";
import { flockSync as registry } from "@/modules/flock";
import { FLOCK_MUTATIONS as M, TRANSFER_REASON, ageOfBatch, type BatchDto, type DailyEntryDto } from "@/modules/flock/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2027-01-01T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("pullets to layers (SPEC-m3 B13)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), rearing: uuidv7(), laying: uuidv7(), pullets: uuidv7() };
  const day = farmDayOf(new Date());
  const placedOn = addFarmDays(day, -105); // 15 weeks ago, as day-old chicks

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "lohmann-brown", name: "Lohmann Brown", productionTypes: ["pullet", "layer"] } });
    const house = (id: string) => m(FARM_MUTATIONS.createHouse, { id, farmId: ids.farm, name: "P", areaM2: 1000, capacity: 6000, type: "closed" });
    await push(a, [m(FARM_MUTATIONS.createFarm, { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }), house(ids.rearing), house(ids.laying)], farmRegistrySync);
    expect(
      await statuses(a, [
        m(M.placeBatch, { id: ids.pullets, houseId: ids.rearing, species: "pullet", strainId: "lohmann-brown", placedOn, chicksPlaced: 4800, deadOnArrival: 0, hatchery: "Couvoir", deliveryNote: "BL-1", chickUnitPriceCentimes: "700", dayOldWeightGrams: null }),
        m(M.recordDay, { batchId: ids.pullets, day, changes: { dead: 5 } }),
      ]),
    ).toEqual(["applied", "applied"]);
  });

  it("closes the pullet batch, culls the birds left behind and starts a layer batch at the birds' age", async () => {
    const newBatchId = uuidv7();
    const transfer = m(M.transferToLaying, { batchId: ids.pullets, day, newBatchId, houseId: ids.laying, hens: 4700 });
    expect(await statuses(b, [m(M.transferToLaying, { batchId: ids.pullets, day, newBatchId, houseId: ids.laying, hens: 4700 })])).toEqual(["errors.NOT_FOUND"]); // another organisation's
    expect(await statuses(a, [m(M.transferToLaying, { batchId: ids.pullets, day, newBatchId, houseId: ids.laying, hens: 4796 })])).toEqual(["errors.MORE_BIRDS_THAN_ON_HAND"]);
    expect(await statuses(a, [transfer])).toEqual(["applied"]);
    expect(await statuses(a, [transfer])).toEqual(["applied"]); // the same mutation again: its stored result
    expect(await statuses(a, [m(M.transferToLaying, { batchId: ids.pullets, day, newBatchId, houseId: ids.laying, hens: 10 })])).toEqual(["errors.ALREADY_EXISTS"]);

    const changes = (await pull(a, 0, registry)).changes;
    const batches = changes.filter((c) => c.entity === "batch").map((c) => c.data as BatchDto);
    const pullets = batches.findLast((x) => x.id === ids.pullets)!;
    const layers = batches.find((x) => x.id === newBatchId)!;
    expect(pullets).toMatchObject({ status: "closed", closedOn: day, closeReason: TRANSFER_REASON });
    expect(layers).toMatchObject({ species: "layer", houseId: ids.laying, chicksPlaced: 4700, fromBatchId: ids.pullets, chickUnitPriceCentimes: "0", ageAtPlacementDays: 105 });
    expect(ageOfBatch(layers, addFarmDays(day, 7) as FarmDay)).toBe(112); // the age goes on: 16 weeks a week later
    const entry = changes.filter((c) => c.entity === "dailyEntry").map((c) => c.data as DailyEntryDto).findLast((e) => e.batchId === ids.pullets);
    expect(entry).toMatchObject({ dead: 5, culled: 95 }); // 4 800 − 5 dead − 4 700 moved
    expect(await db.auditEvent.count({ where: { entityId: newBatchId, action: "create" } })).toBe(1);
  });

  it("refuses a transfer into a house that already has a batch", async () => {
    const pullets = uuidv7();
    const placed = await statuses(a, [m(M.placeBatch, { id: pullets, houseId: ids.rearing, species: "pullet", strainId: "lohmann-brown", placedOn: day, chicksPlaced: 100, deadOnArrival: 0, hatchery: "C", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null })]);
    expect(placed).toEqual(["applied"]);
    expect(await statuses(a, [m(M.transferToLaying, { batchId: pullets, day, newBatchId: uuidv7(), houseId: ids.laying, hens: 100 })])).toEqual(["errors.HOUSE_HAS_OPEN_BATCH"]);
    expect((await db.batch.findUniqueOrThrow({ where: { id: pullets } })).status).toBe("open"); // nothing written
  });
});
