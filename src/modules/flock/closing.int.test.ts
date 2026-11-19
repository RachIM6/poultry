import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmRegistrySync } from "@/modules/farm-registry";
import { FARM_MUTATIONS } from "@/modules/farm-registry/schema";
import { flockSync, recordBirdsSold } from "@/modules/flock";
import { FLOCK_MUTATIONS as F, type BatchDto } from "@/modules/flock/schema";
import { inventorySync } from "@/modules/inventory";
import { INVENTORY_MUTATIONS as I } from "@/modules/inventory/schema";
import { twoTenants } from "@/test/tenant";

const registry: SyncRegistry = {
  mutations: { ...flockSync.mutations, ...inventorySync.mutations },
  entities: { ...flockSync.entities, ...inventorySync.entities },
};
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-06T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));
const pulledBatch = async (ctx: TenantContext, id: string) => (await pull(ctx, 0, registry)).changes.filter((c) => c.entity === "batch" && c.id === id).at(-1)?.data as BatchDto;

describe("closing a batch and its cost per kg (SPEC B6)", () => {
  let a: TenantContext;
  const [farm, house, feed, batch, next] = Array.from({ length: 5 }, () => uuidv7());
  const place = (id: string) =>
    m(F.placeBatch, { id, houseId: house, strainId: "ross-308", placedOn: "2026-10-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null });
  // What sales does for a sale (sales isn't a dependency of flock, so the test calls flock directly).
  const sell = (birds: number, liveWeightGrams: number) =>
    db.$transaction((tx) => recordBirdsSold(tx, a, { id: uuidv7(), batchId: batch, day: "2026-11-05", birds, liveWeightGrams }, { mutationId: uuidv7(), deviceCreatedAt: new Date() }));

  beforeAll(async () => {
    [a] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    await push(a, [
      m(FARM_MUTATIONS.createFarm, { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m(FARM_MUTATIONS.createHouse, { id: house, farmId: farm, name: "B1", areaM2: 1200, capacity: 12000, type: "closed" }),
    ], farmRegistrySync);
    const supplier = uuidv7();
    expect(
      await statuses(a, [
        m(I.createSupplier, { id: supplier, name: "Alf", phone: null }),
        m(I.createStockItem, { id: feed, farmId: farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
        // 1 000 kg at 4,50 DH/kg = 4 500 DH
        m(I.recordPurchase, { id: uuidv7(), movementId: uuidv7(), supplierId: supplier, stockItemId: feed, day: "2026-10-01", quantity: 1_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null }),
        place(batch),
        m(F.recordDay, { batchId: batch, day: "2026-10-02", changes: { feed: { stockItemId: feed, grams: 100_000 } } }), // 100 kg → 450 DH
      ]),
    ).toEqual(Array(5).fill("applied"));
  });

  it("takes other costs only from owners and managers, while the batch is open", async () => {
    const cost = (payload: object = {}) => m(F.recordBatchCost, { id: uuidv7(), batchId: batch, day: "2026-10-20", label: "Électricité", amountCentimes: "20000", ...payload });
    expect(await statuses({ ...a, role: "worker" }, [cost()])).toEqual(["FORBIDDEN"]);
    expect(await statuses(a, [cost({ amountCentimes: "0" }), cost({ day: "2026-09-30" })])).toEqual(["INVALID_QUANTITY", "DAY_BEFORE_PLACEMENT"]);
    expect(await statuses(a, [cost()])).toEqual(["applied"]); // 200 DH
  });

  it("the sale of the last birds closes the batch and locks its cost per kg; then nothing changes and the house is free", async () => {
    expect((await sell(400, 800_000)).ok).toBe(true);
    expect((await db.batch.findUniqueOrThrow({ where: { id: batch } })).status).toBe("open");
    expect((await sell(600, 1_200_000)).ok).toBe(true); // the last ones

    // Chicks 1 000 × 4,50 = 4 500 DH + feed 450 DH + other 200 DH = 5 150 DH, over 2 000 kg sold = 2,575 → 2,58 DH/kg.
    expect(await pulledBatch(a, batch)).toMatchObject({ status: "closed", closedOn: "2026-11-05", closeReason: null, soldGrams: 2_000_000, costCentimes: "515000", costPerKgCentimes: "258" });
    const forWorker = await pulledBatch({ ...a, role: "worker" }, batch);
    expect(forWorker).toMatchObject({ status: "closed", soldGrams: 2_000_000 });
    expect(forWorker).not.toHaveProperty("costCentimes");
    expect(forWorker).not.toHaveProperty("costPerKgCentimes");
    expect(await db.auditEvent.count({ where: { entity: "Batch", entityId: batch, action: "close" } })).toBe(1);

    expect(
      await statuses(a, [
        m(F.recordDay, { batchId: batch, day: "2026-11-05", changes: { dead: 1 } }),
        m(F.recordBatchCost, { id: uuidv7(), batchId: batch, day: "2026-11-05", label: "Gaz", amountCentimes: "100" }),
        m(F.closeBatch, { batchId: batch, day: "2026-11-05", reason: "Again" }),
      ]),
    ).toEqual(["BATCH_CLOSED", "BATCH_CLOSED", "BATCH_CLOSED"]);
    expect((await sell(1, 2000)).ok).toBe(false);
    expect(await statuses(a, [place(next)])).toEqual(["applied"]); // the house is free
  });

  it("closes by hand with a reason, birds on hand or not; nothing sold, no cost per kg", async () => {
    const close = (payload: object = {}) => m(F.closeBatch, { batchId: next, day: "2026-11-06", reason: "Maladie : abattage sanitaire", ...payload });
    expect(await statuses({ ...a, role: "worker" }, [close()])).toEqual(["FORBIDDEN"]);
    expect(await statuses(a, [close({ reason: "" })])).toEqual(["INVALID_INPUT"]);
    expect(await statuses(a, [close()])).toEqual(["applied"]);
    expect(await pulledBatch(a, next)).toMatchObject({ status: "closed", closeReason: "Maladie : abattage sanitaire", soldGrams: 0, costCentimes: "450000", costPerKgCentimes: null });
  });
});
