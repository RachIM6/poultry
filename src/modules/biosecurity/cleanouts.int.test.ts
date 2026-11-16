import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T18:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: ReturnType<typeof m>[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("clean-out and downtime through sync (SPEC-m2-compliance BS4, BS5, BS9, CX2)", () => {
  let a: TenantContext, b: TenantContext;
  const [farmId, houseId, openHouse, closed, open] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const place = (id: string, house: string, placedOn: string) =>
    m("flock.placeBatch", { id, houseId: house, strainId: "ross-308", placedOn, chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null });
  const step = (cleanoutId: string, over: object = {}) => ({ id: uuidv7(), cleanoutId, step: "manureOut", day: "2026-11-03", product: null, dose: null, productLot: null, note: null, ...over });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    const house = { areaM2: 1000, capacity: 10000, type: "closed" };
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: farmId, name: "El Kheir", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: houseId, farmId, name: "Bâtiment 1", ...house }),
        m("farm-registry.createHouse", { id: openHouse, farmId, name: "Bâtiment 2", ...house }),
        place(closed, houseId, "2026-09-21"),
        m("flock.closeBatch", { batchId: closed, day: "2026-11-02", reason: "Fin de lot" }),
        place(open, openHouse, "2026-10-05"),
      ),
    ).toEqual(["applied", "applied", "applied", "applied", "applied", "applied"]);
  });

  it("a clean-out follows a closed batch, once; its steps are marked once each, by a worker too", async () => {
    const worker = { ...a, role: "worker" as const };
    const id = uuidv7();
    expect(await statuses(worker, m("biosecurity.startCleanout", { id, houseId, afterBatchId: closed, startedOn: "2026-11-03" }))).toEqual(["applied"]);
    expect(await statuses(worker, m("biosecurity.startCleanout", { id: uuidv7(), houseId, afterBatchId: closed, startedOn: "2026-11-03" }))).toEqual(["errors.CLEANOUT_ALREADY_STARTED"]);
    expect(await statuses(worker, m("biosecurity.startCleanout", { id: uuidv7(), houseId: openHouse, afterBatchId: open, startedOn: "2026-11-03" }))).toEqual(["errors.BATCH_NOT_CLOSED"]);
    // Another house's batch, even on the same farm, is not this house's clean-out.
    expect(await statuses(worker, m("biosecurity.startCleanout", { id: uuidv7(), houseId: openHouse, afterBatchId: closed, startedOn: "2026-11-03" }))).toEqual(["errors.NOT_FOUND"]);

    const manure = step(id);
    expect(await statuses(worker, m("biosecurity.recordCleanoutStep", manure))).toEqual(["applied"]);
    expect(await statuses(worker, m("biosecurity.recordCleanoutStep", step(id)))).toEqual(["errors.STEP_ALREADY_DONE"]);
    expect(await statuses(worker, m("biosecurity.recordCleanoutStep", step(id, { step: "disinfection" })))).toEqual(["errors.DISINFECTANT_REQUIRED"]);
    const disinfection = step(id, { step: "disinfection", day: "2026-11-05", product: "Virkon S", dose: "1 %", productLot: "L2611" });
    expect(await statuses(worker, m("biosecurity.recordCleanoutStep", disinfection))).toEqual(["applied"]);
    expect(await db.auditEvent.count({ where: { entityId: { in: [id, manure.id, disinfection.id] } } })).toBe(3);

    const pulled = (await pull(worker, 0, registry)).changes.filter((c) => c.entity === "cleanout").map((c) => c.data);
    expect(pulled.at(-1)).toEqual({ id, farmId, houseId, afterBatchId: closed, startedOn: "2026-11-03", steps: [manure, disinfection].map((s) => ({ ...s, cleanoutId: undefined })) });
  });

  it("the farm's minimum downtime is the owner's or manager's to set, not a worker's", async () => {
    expect(await statuses({ ...a, role: "worker" }, m("biosecurity.setMinDowntime", { farmId, minDays: 14 }))).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(a, m("biosecurity.setMinDowntime", { farmId, minDays: 14 }))).toEqual(["applied"]);
    const setting = (await pull(a, 0, registry)).changes.filter((c) => c.entity === "downtimeSetting").at(-1);
    expect(setting?.data).toEqual({ id: farmId, farmId, minDays: 14 });
  });

  it("keeps organisations apart", async () => {
    expect(await statuses(b, m("biosecurity.startCleanout", { id: uuidv7(), houseId, afterBatchId: closed, startedOn: "2026-11-03" }))).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(b, m("biosecurity.setMinDowntime", { farmId, minDays: 1 }))).toEqual(["errors.NOT_FOUND"]);
    expect((await pull(b, 0, registry)).changes.filter((c) => ["cleanout", "downtimeSetting"].includes(c.entity))).toEqual([]);
  });
});
