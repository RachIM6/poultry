import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmRegistrySync } from "@/modules/farm-registry";
import { FARM_MUTATIONS } from "@/modules/farm-registry/schema";
import { flockSync } from "@/modules/flock";
import { FLOCK_MUTATIONS as F, dailyEntryId, type DailyEntryDto } from "@/modules/flock/schema";
import { inventorySync, stockOnHand } from "@/modules/inventory";
import { INVENTORY_MUTATIONS as I, type MovementDto } from "@/modules/inventory/schema";
import { twoTenants } from "@/test/tenant";

const registry: SyncRegistry = {
  mutations: { ...flockSync.mutations, ...inventorySync.mutations },
  entities: { ...flockSync.entities, ...inventorySync.entities },
};
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-06T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const kg = (n: number) => n * 1000;

describe("daily entry and automatic feed consumption (SPEC B2, S4, X2)", () => {
  let a: TenantContext, b: TenantContext;
  const [farm, otherFarm, house, starter, otherFarmFeed, batch] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const day = (batchDay: string, changes: Record<string, unknown>) => m(F.recordDay, { batchId: batch, day: batchDay, changes });
  const feed = (grams: number, stockItemId = starter) => ({ stockItemId, grams });
  const consumption = (entryDay: string) => db.stockMovement.findMany({ where: { id: dailyEntryId(batch, entryDay) } });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    const farmFields = { region: "R", province: "P", commune: "C", gps: null, onssa: null };
    await push(a, [
      m(FARM_MUTATIONS.createFarm, { id: farm, name: "F", ...farmFields }),
      m(FARM_MUTATIONS.createFarm, { id: otherFarm, name: "G", ...farmFields }),
      m(FARM_MUTATIONS.createHouse, { id: house, farmId: farm, name: "B1", areaM2: 1200, capacity: 12000, type: "closed" }),
    ], farmRegistrySync);
    const supplier = uuidv7();
    const item = (id: string, farmId: string) => m(I.createStockItem, { id, farmId, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null });
    expect(
      await statuses(a, [
        m(I.createSupplier, { id: supplier, name: "Alf", phone: null }),
        item(starter, farm),
        item(otherFarmFeed, otherFarm),
        m(I.recordPurchase, { id: uuidv7(), movementId: uuidv7(), supplierId: supplier, stockItemId: starter, day: "2026-10-14", quantity: kg(2000), unitPriceCentimes: "450", paidCentimes: "0", dueOn: null }),
        m(F.placeBatch, { id: batch, houseId: house, strainId: "ross-308", placedOn: "2026-10-14", chicksPlaced: 1000, deadOnArrival: 10, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null }),
      ]),
    ).toEqual(["applied", "applied", "applied", "applied", "applied"]);
  });

  it("merges two phones' offline entries for the same day into one, auditing what was overwritten", async () => {
    const fromA = day("2026-10-20", { dead: 3, feed: feed(kg(85)) });
    const fromB = day("2026-10-20", { dead: 5, deathCause: "heat" }); // B never touched the feed
    expect(await statuses(a, [fromA])).toEqual(["applied"]);
    expect(await statuses(a, [fromB])).toEqual(["applied"]);

    expect(await db.dailyEntry.count({ where: { batchId: batch, day: new Date("2026-10-20T00:00:00Z") } })).toBe(1);
    const entries = (await pull(a, 0, registry)).changes.filter((c) => c.entity === "dailyEntry").map((c) => c.data as DailyEntryDto);
    expect(entries.at(-1)).toMatchObject({ id: dailyEntryId(batch, "2026-10-20"), dead: 5, deathCause: "heat", culled: 0, feed: feed(kg(85)) });
    expect(await db.auditEvent.findFirstOrThrow({ where: { mutationId: fromB.id } })).toMatchObject({ before: { dead: 3, deathCause: null }, after: { dead: 5, deathCause: "heat" } });
  });

  it("turns the feed into exactly one consumption movement, updated when the kg change and removed when cleared", async () => {
    expect(await consumption("2026-10-20")).toEqual([expect.objectContaining({ kind: "consumption", quantity: -kg(85), stockItemId: starter })]);
    await statuses(a, [day("2026-10-20", { feed: feed(kg(90)) })]);
    expect((await consumption("2026-10-20")).map((mv) => mv.quantity)).toEqual([-kg(90)]);

    const movements = (await pull(a, 0, registry)).changes.filter((c) => c.entity === "movement" && c.data).map((c) => c.data as MovementDto);
    const latest = [...new Map(movements.map((mv) => [mv.id, mv])).values()]; // the phone keeps the last version of each
    expect(stockOnHand(latest).get(starter)).toBe(kg(2000 - 90));

    await statuses(a, [day("2026-10-20", { feed: null })]);
    expect(await consumption("2026-10-20")).toEqual([]);
    const tombstone = (await pull(a, 0, registry)).changes.filter((c) => c.id === dailyEntryId(batch, "2026-10-20") && c.entity === "movement").at(-1);
    expect(tombstone?.data).toBeNull();
  });

  it("keeps one entry and one movement when two phones save the same day at the same moment", async () => {
    await Promise.all([
      statuses(a, [day("2026-10-21", { dead: 1, feed: feed(kg(80)) })]),
      statuses(a, [day("2026-10-21", { culled: 2, feed: feed(kg(82)) })]),
    ]);
    const row = await db.dailyEntry.findUniqueOrThrow({ where: { id: dailyEntryId(batch, "2026-10-21") } });
    expect([row.dead, row.culled]).toEqual([1, 2]); // different fields both survive
    expect(await consumption("2026-10-21")).toHaveLength(1);
    expect([-kg(80), -kg(82)]).toContain((await consumption("2026-10-21"))[0].quantity);
  });

  it("refuses impossible days without writing anything, and lets workers enter the day", async () => {
    const worker = { ...a, role: "worker" as const };
    expect(
      await statuses(worker, [
        day("2026-10-22", { dead: 990 }), // 1 000 − 10 on arrival − 3 already out
        day("2026-10-13", { dead: 1 }),
        day("2026-10-22", { feed: feed(kg(10), otherFarmFeed) }), // feed of another farm
        day("2026-10-22", { dead: 2, deathCause: "heat", waterMl: 150_000 }),
      ]),
    ).toEqual(["errors.MORE_DEAD_THAN_ON_HAND", "errors.DAY_BEFORE_PLACEMENT", "errors.NOT_FOUND", "applied"]);
    expect(await consumption("2026-10-22")).toEqual([]);
    expect(await statuses(b, [day("2026-10-23", { dead: 1 })])).toEqual(["errors.NOT_FOUND"]);
  });
});
