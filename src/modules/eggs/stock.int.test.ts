import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { EGG_MUTATIONS as M, eggLots, type EggCollectionDto, type EggDiscardDto, type EggGradingDto } from "@/modules/eggs/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-16T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const counts = (normal: number, cracked = 0) => ({ normal, cracked, dirty: 0, doubleYolk: 0, floor: 0, broken: 0 });

describe("egg stock, grading and discards (SPEC-m3 E2, E3)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), layers: uuidv7(), collection: uuidv7() };
  const day = farmDayOf(new Date());

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "lohmann-brown", name: "Lohmann Brown", productionTypes: ["pullet", "layer"] } });
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "P1", areaM2: 1000, capacity: 6000, type: "closed" }),
        m("flock.placeBatch", { id: ids.layers, houseId: ids.house, species: "layer", strainId: "lohmann-brown", placedOn: day, chicksPlaced: 6000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 200 }),
        m(M.recordCollection, { id: ids.collection, batchId: ids.layers, day, counts: counts(1000, 20), sample: null }),
      ),
    ).toEqual(Array(4).fill("applied"));
  });

  it("grades a day's eggs and discards some, never more than the lot holds", async () => {
    const grade = (grades: Record<string, number>) => m(M.gradeEggs, { id: uuidv7(), batchId: ids.layers, laidOn: day, grades });
    const discard = (item: string, eggs: number) => m(M.discardEggs, { id: uuidv7(), batchId: ids.layers, laidOn: day, item, eggs, reason: "Cassés au transport" });
    expect(await statuses(a, grade({ m: 600, l: 300 }), grade({ m: 101 }), discard("grade:l", 20), discard("downgraded", 21))).toEqual([
      "applied",
      "errors.NOT_ENOUGH_EGGS", // only 100 ungraded left
      "applied",
      "errors.NOT_ENOUGH_EGGS",
    ]);
    expect(await statuses(b, grade({ m: 1 }))).toEqual(["errors.NOT_FOUND"]); // another organisation's batch

    const changes = (await pull(a, 0, registry)).changes;
    const of = <T,>(e: string) => changes.filter((c) => c.entity === e).map((c) => c.data as T);
    const lots = eggLots({ collections: of<EggCollectionDto>("eggCollection"), gradings: of<EggGradingDto>("eggGrading"), discards: of<EggDiscardDto>("eggDiscard") });
    expect(lots.map((l) => [l.item, l.eggs])).toEqual([["ungraded", 100], ["downgraded", 20], ["grade:l", 280], ["grade:m", 600]]);
    expect(await db.auditEvent.count({ where: { entity: { in: ["EggGrading", "EggDiscard"] } } })).toBe(2);
  });

  it("refuses a correction that would take back eggs already graded", async () => {
    expect(await statuses(a, m(M.correctCollection, { id: ids.collection, counts: counts(899, 20), sample: null }))).toEqual(["errors.NOT_ENOUGH_EGGS"]); // 900 graded
    expect(await statuses(a, m(M.correctCollection, { id: ids.collection, counts: counts(950, 20), sample: null }))).toEqual(["applied"]);
  });

  it("keeps a closed batch's eggs in stock: they can still be graded", async () => {
    await db.batch.update({ where: { id: ids.layers }, data: { status: "closed" } });
    expect(await statuses(a, m(M.gradeEggs, { id: uuidv7(), batchId: ids.layers, laidOn: day, grades: { s: 50 } }))).toEqual(["applied"]);
  });
});
