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

describe("dead-bird disposal and manure through sync (SPEC-m2-compliance BS6, BS7, CX2)", () => {
  let a: TenantContext, b: TenantContext;
  const [farmId, otherFarm, houseId, batchId, feed] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const disposal = (over: object = {}) => ({ id: uuidv7(), farmId, day: "2026-11-05", batchId, birds: 6, weightGrams: 9800, method: "incineration", methodNote: null, ...over });
  const manure = (over: object = {}) => ({ id: uuidv7(), farmId, day: "2026-11-03", houseId, batchId, quantityKg: 18000, destination: "stored", recipient: null, ...over });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    const farm = { region: "R", province: "P", commune: "C", gps: null, onssa: null };
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: farmId, name: "El Kheir", ...farm }),
        m("farm-registry.createFarm", { id: otherFarm, name: "Sidi Hajjaj", ...farm }),
        m("farm-registry.createHouse", { id: houseId, farmId, name: "Bâtiment 1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("inventory.createStockItem", { id: feed, farmId, productId: null, kind: "feed", name: "Croissance", unit: "kg", lot: null, expiresOn: null }),
        m("flock.placeBatch", { id: batchId, houseId, strainId: "ross-308", placedOn: "2026-09-21", chicksPlaced: 10000, deadOnArrival: 0, hatchery: "Couvoir Chaouia", deliveryNote: "CC-26-0974", chickUnitPriceCentimes: "450", dayOldWeightGrams: null }),
      ),
    ).toEqual(["applied", "applied", "applied", "applied", "applied"]);
  });

  it("a worker records a disposal and a manure removal once; both are audited and pulled", async () => {
    const worker = { ...a, role: "worker" as const };
    const [d, r] = [disposal(), manure()];
    const sent = m("biosecurity.recordDisposal", d);
    expect(await statuses(worker, sent, sent, m("biosecurity.recordManure", r))).toEqual(["applied", "applied", "applied"]);
    expect(await statuses(worker, m("biosecurity.recordDisposal", d))).toEqual(["errors.ALREADY_EXISTS"]);
    expect(await db.disposal.count({ where: { id: d.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entityId: { in: [d.id, r.id] }, action: "create" } })).toBe(2);
    const pulled = (await pull(worker, 0, registry)).changes.filter((c) => ["disposal", "manureRemoval"].includes(c.entity));
    expect(pulled.map((c) => c.data)).toEqual([d, r]);
  });

  it("'other' needs a description (CQ4)", async () => {
    expect(await statuses(a, m("biosecurity.recordDisposal", disposal({ method: "other" })))).toEqual(["errors.DISPOSAL_METHOD_NOTE_REQUIRED"]);
    expect(await statuses(a, m("biosecurity.recordDisposal", disposal({ method: "other", methodNote: "fosse fermée, chaux vive" })))).toEqual(["applied"]);
  });

  it("a house or batch must be on the farm given", async () => {
    expect(await statuses(a, m("biosecurity.recordDisposal", disposal({ farmId: otherFarm })))).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(a, m("biosecurity.recordManure", manure({ farmId: otherFarm, batchId: null })))).toEqual(["errors.NOT_FOUND"]);
  });

  it("keeps organisations apart", async () => {
    expect(await statuses(b, m("biosecurity.recordDisposal", disposal()), m("biosecurity.recordManure", manure()))).toEqual(["errors.NOT_FOUND", "errors.NOT_FOUND"]);
    expect((await pull(b, 0, registry)).changes.filter((c) => ["disposal", "manureRemoval"].includes(c.entity))).toEqual([]);
  });
});
