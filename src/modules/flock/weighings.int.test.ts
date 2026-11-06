import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmRegistrySync } from "@/modules/farm-registry";
import { FARM_MUTATIONS } from "@/modules/farm-registry/schema";
import { flockSync } from "@/modules/flock";
import { FLOCK_MUTATIONS as F, sampleStats, type WeighingDto } from "@/modules/flock/schema";
import { twoTenants } from "@/test/tenant";
import { db } from "@/lib/db";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-06T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, flockSync)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));

describe("weighings (SPEC B3)", () => {
  let a: TenantContext, b: TenantContext;
  const [farm, house, batch] = [uuidv7(), uuidv7(), uuidv7()];
  const weigh = (day: string, sample: unknown, id = uuidv7()) => m(F.recordWeighing, { id, batchId: batch, day, sample });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    await push(a, [
      m(FARM_MUTATIONS.createFarm, { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m(FARM_MUTATIONS.createHouse, { id: house, farmId: farm, name: "B1", areaM2: 1200, capacity: 12000, type: "closed" }),
    ], farmRegistrySync);
    expect(
      await statuses(a, [m(F.placeBatch, { id: batch, houseId: house, strainId: "ross-308", placedOn: "2026-10-14", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null })]),
    ).toEqual(["applied"]);
  });

  it("keeps individual and group samples, pulled with the same average and CV as on the phone", async () => {
    expect(await statuses(a, [weigh("2026-11-04", { weightsGrams: [2000, 2100, 1900, 2200, 1800] }), weigh("2026-11-05", { totalGrams: 102_500, count: 50 })])).toEqual(["applied", "applied"]);
    const pulled = (await pull(a, 0, flockSync)).changes.filter((c) => c.entity === "weighing").map((c) => c.data as WeighingDto);
    expect(pulled.map((w) => sampleStats(w.weightsGrams.length ? w : { totalGrams: w.totalGrams, count: w.count }))).toEqual([
      { count: 5, averageGrams: 2000, cvPercent: 7.9 },
      { count: 50, averageGrams: 2050, cvPercent: null },
    ]);
    expect(await db.auditEvent.count({ where: { entity: "Weighing", organizationId: a.organizationId } })).toBe(2);
  });

  it("refuses impossible samples, days outside the batch and other organisations' batches, writing nothing", async () => {
    const before = await db.weighing.count();
    expect(
      await statuses(a, [weigh("2026-11-05", { weightsGrams: [2000, 0] }), weigh("2026-11-05", { totalGrams: 10_000, count: 0 }), weigh("2026-10-13", { weightsGrams: [40] }), weigh("2026-12-30", { weightsGrams: [2000] })]),
    ).toEqual(["INVALID_SAMPLE", "INVALID_SAMPLE", "DAY_BEFORE_PLACEMENT", "DAY_IN_FUTURE"]);
    expect(await statuses(b, [weigh("2026-11-05", { weightsGrams: [2000] })])).toEqual(["NOT_FOUND"]);
    expect(await db.weighing.count()).toBe(before);
  });
});
