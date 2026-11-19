import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { flockSync } from "@/modules/flock";
import { FLOCK_MUTATIONS as F, dailyEntryId } from "@/modules/flock/schema";
import { healthSync } from "@/modules/health";
import { HEALTH_MUTATIONS as H, type TreatmentDto, type VetVisitDto } from "@/modules/health/schema";
import { inventorySync, stockOnHand } from "@/modules/inventory";
import { INVENTORY_MUTATIONS as I, type MovementDto } from "@/modules/inventory/schema";
import { twoTenants } from "@/test/tenant";

const registry: SyncRegistry = {
  mutations: { ...inventorySync.mutations, ...flockSync.mutations, ...healthSync.mutations },
  entities: { ...inventorySync.entities, ...flockSync.entities, ...healthSync.entities },
};
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-02T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));
const pulled = async <T,>(ctx: TenantContext, entity: string) => (await pull(ctx, 0, registry)).changes.filter((c) => c.entity === entity).map((c) => c.data as T);

describe("treatments, withdrawal and vet visits (SPEC H3–H6, S4)", () => {
  let a: TenantContext, b: TenantContext;
  const [farm, house, batch, supplier, medicine, vaccine, purchaseMovement] = Array.from({ length: 7 }, () => uuidv7());
  // Made-up withdrawal days, to test the mechanics only: the real ones come from each medicine's label (OQ4).
  const treatment = (payload: object = {}) =>
    m(H.recordTreatment, {
      id: uuidv7(),
      batchId: batch,
      stockItemId: medicine,
      quantity: 500,
      dose: "1 ml par litre",
      startOn: "2026-10-30",
      endOn: "2026-11-02",
      reason: "Toux",
      prescriber: "Dr Alaoui",
      withdrawalDays: 5,
      ...payload,
    });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    await db.product.create({ data: { id: "vaccine-newcastle", kind: "vaccine", nameFr: "Vaccin Newcastle", nameAr: "لقاح نيوكاسل" } });
    // The farm and its house straight in the database: health doesn't depend on farm-registry (CAPABILITY-MAP.md).
    await db.farm.create({ data: { id: farm, organizationId: a.organizationId, name: "F", region: "R", province: "P", commune: "C" } });
    await db.house.create({ data: { id: house, organizationId: a.organizationId, farmId: farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } });
    const item = (id: string, kind: string, productId: string | null) =>
      m(I.createStockItem, { id, farmId: farm, productId, kind, name: kind, unit: kind === "medicine" ? "ml" : "dose", lot: "L1", expiresOn: "2027-06-30" });
    expect(
      await statuses(a, [
        m(I.createSupplier, { id: supplier, name: "Véto", phone: null }),
        item(medicine, "medicine", null),
        item(vaccine, "vaccine", "vaccine-newcastle"),
        m(I.recordPurchase, { id: uuidv7(), movementId: purchaseMovement, supplierId: supplier, stockItemId: medicine, day: "2026-10-25", quantity: 2000, unitPriceCentimes: "10", paidCentimes: "0", dueOn: null }),
        m(F.placeBatch, { id: batch, houseId: house, strainId: "ross-308", placedOn: "2026-10-25", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null }),
      ]),
    ).toEqual(Array(5).fill("applied"));
  });

  it("S3: a treatment can't take the id of a movement already in the ledger (T25 security review)", async () => {
    const purchase = () => db.stockMovement.findUniqueOrThrow({ where: { id: purchaseMovement }, select: { kind: true, quantity: true, stockItemId: true } });
    const before = await purchase();
    expect(await statuses({ ...a, role: "worker" }, [treatment({ id: purchaseMovement })])).toEqual(["ALREADY_EXISTS"]);
    expect(await purchase()).toEqual(before); // still the purchase of 2 000 ml
    // Nor a daily entry's id (UUIDv5, computed), which the entry would later replace: phones' ids are UUIDv7.
    expect(await statuses(a, [treatment({ id: dailyEntryId(batch, "2026-11-01") })])).toEqual(["INVALID_INPUT"]);
    expect(await db.treatment.count()).toBe(0);
  });

  it("H3: a treatment is kept with its withdrawal end, and its medicine leaves the lot", async () => {
    expect(await statuses(b, [treatment()])).toEqual(["NOT_FOUND"]); // another organisation's batch
    expect(await statuses(a, [treatment({ endOn: "2026-10-29" })])).toEqual(["END_BEFORE_START"]);
    expect(await statuses(a, [treatment({ startOn: "2026-10-24" })])).toEqual(["DAY_BEFORE_PLACEMENT"]);
    expect(await statuses(a, [treatment({ stockItemId: vaccine })])).toEqual(["WRONG_STOCK_ITEM"]); // a vaccine, not a medicine
    expect(await statuses(a, [treatment({ withdrawalDays: undefined })])).toEqual(["INVALID_INPUT"]); // never a default
    expect(await db.treatment.count()).toBe(0); // nothing written by a rejection

    const given = treatment();
    expect(await statuses(a, [given])).toEqual(["applied"]);
    expect(await statuses(a, [{ ...given, id: uuidv7() }])).toEqual(["ALREADY_EXISTS"]); // same treatment, sent again
    const [saved] = await pulled<TreatmentDto>(a, "treatment");
    expect(saved).toMatchObject({ id: (given.payload as { id: string }).id, endOn: "2026-11-02", withdrawalDays: 5, withdrawalEndsOn: "2026-11-07", byUserId: a.userId });
    const movements = await pulled<MovementDto>(a, "movement");
    expect(movements.find((x) => x.id === saved.id)).toMatchObject({ kind: "consumption", quantity: -500, day: "2026-10-30" });
    expect(stockOnHand(movements).get(medicine)).toBe(1500);
    expect(await db.auditEvent.count({ where: { entity: "Treatment", entityId: saved.id } })).toBe(1);
    expect(await pulled(b, "treatment")).toEqual([]);
  });

  it("H5: a vet visit is kept for the batch, by day", async () => {
    const visit = (payload: object = {}) => m(H.recordVetVisit, { id: uuidv7(), batchId: batch, on: "2026-11-01", vetName: "Dr Alaoui", notes: "Toux, traitement prescrit.", ...payload });
    expect(await statuses(a, [visit({ on: "2026-10-24" })])).toEqual(["DAY_BEFORE_PLACEMENT"]);
    expect(await statuses(b, [visit()])).toEqual(["NOT_FOUND"]);
    expect(await statuses(a, [visit()])).toEqual(["applied"]);
    expect(await pulled<VetVisitDto>(a, "vetVisit")).toEqual([
      expect.objectContaining({ batchId: batch, on: "2026-11-01", vetName: "Dr Alaoui", notes: "Toux, traitement prescrit.", byUserId: a.userId }),
    ]);
    expect(await pulled(b, "vetVisit")).toEqual([]);
  });
});
