import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { farmInstant, type FarmDay } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { flockSync } from "@/modules/flock";
import { FLOCK_MUTATIONS as F } from "@/modules/flock/schema";
import { healthSync, sendVaccinationReminders } from "@/modules/health";
import { HEALTH_MUTATIONS as H, planFor, type VaccinationDto } from "@/modules/health/schema";
import { inventorySync, stockOnHand } from "@/modules/inventory";
import { INVENTORY_MUTATIONS as I, type MovementDto } from "@/modules/inventory/schema";
import { twoTenants } from "@/test/tenant";

const registry: SyncRegistry = {
  mutations: { ...inventorySync.mutations, ...flockSync.mutations, ...healthSync.mutations },
  entities: { ...inventorySync.entities, ...flockSync.entities, ...healthSync.entities },
};
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-06T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));

// A made-up protocol, to test the mechanics only: NOT a vaccination schedule (the default one waits for a vet, OQ4).
const ITEMS = [
  { dayOfAge: 0, productId: "vaccine-newcastle", method: "spray" },
  { dayOfAge: 14, productId: "vaccine-gumboro", method: "drinkingWater" },
  { dayOfAge: 14, productId: "vaccine-infectious-bronchitis", method: "drinkingWater" },
  { dayOfAge: 15, productId: "vaccine-newcastle", method: "drinkingWater" },
] as const;
const PLACED_ON = "2026-10-25" as FarmDay;

describe("vaccination plan, vaccinations given and reminders (SPEC H1, H2, S4)", () => {
  let a: TenantContext, b: TenantContext;
  const [farm, house, batch, protocol, otherProtocol, supplier, newcastleLot, gumboroLot, feed] = Array.from({ length: 9 }, () => uuidv7());
  const plan = planFor(batch, PLACED_ON, [...ITEMS]);
  const done = (line: number, stockItemId: string, doses = 990, on = PLACED_ON as string) =>
    m(H.recordVaccination, { id: plan[line].id, on, stockItemId, doses, method: ITEMS[line].method });
  const pulled = async () => (await pull(a, 0, registry)).changes.filter((c) => c.entity === "vaccination").map((c) => c.data as VaccinationDto);

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    await db.product.createMany({
      data: [
        { id: "vaccine-newcastle", kind: "vaccine", nameFr: "Vaccin Newcastle", nameAr: "لقاح نيوكاسل" },
        { id: "vaccine-gumboro", kind: "vaccine", nameFr: "Vaccin Gumboro", nameAr: "لقاح الجمبورو" },
        { id: "vaccine-infectious-bronchitis", kind: "vaccine", nameFr: "Vaccin BI", nameAr: "لقاح" },
        { id: "feed-starter", kind: "feed", nameFr: "Démarrage", nameAr: "علف" },
      ],
    });
    // The farm and its house straight in the database: health doesn't depend on farm-registry (CAPABILITY-MAP.md).
    await db.farm.create({ data: { id: farm, organizationId: a.organizationId, name: "F", region: "R", province: "P", commune: "C" } });
    await db.house.create({ data: { id: house, organizationId: a.organizationId, farmId: farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } });
    await db.vaccinationProtocol.createMany({
      data: [
        { id: protocol, organizationId: a.organizationId, name: "Programme", items: [...ITEMS] },
        { id: otherProtocol, organizationId: b.organizationId, name: "Autre", items: [] },
      ],
    });
    const lot = (id: string, productId: string | null, kind = "vaccine") =>
      m(I.createStockItem, { id, farmId: farm, productId, kind, name: kind, unit: kind === "feed" ? "kg" : "dose", lot: kind === "feed" ? null : "L1", expiresOn: kind === "feed" ? null : "2027-06-30" });
    expect(
      await statuses(a, [
        m(I.createSupplier, { id: supplier, name: "Véto", phone: null }),
        lot(newcastleLot, "vaccine-newcastle"),
        lot(gumboroLot, "vaccine-gumboro"),
        lot(feed, "feed-starter", "feed"),
        m(I.recordPurchase, { id: uuidv7(), movementId: uuidv7(), supplierId: supplier, stockItemId: newcastleLot, day: PLACED_ON, quantity: 5000, unitPriceCentimes: "20", paidCentimes: "0", dueOn: null }),
        m(F.placeBatch, { id: batch, houseId: house, strainId: "ross-308", placedOn: PLACED_ON, chicksPlaced: 1000, deadOnArrival: 10, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null }),
      ]),
    ).toEqual(Array(6).fill("applied"));
  });

  it("H1: the batch gets the protocol's lines with their due days, once", async () => {
    const send = (payload: object, ctx = a) => statuses(ctx, [m(H.planVaccinations, { batchId: batch, protocolId: protocol, items: ITEMS, ...payload })]);
    expect(await send({ protocolId: otherProtocol })).toEqual(["NOT_FOUND"]); // another organisation's protocol
    expect(await send({ items: [{ dayOfAge: 3, productId: "feed-starter", method: "spray" }] })).toEqual(["INVALID_INPUT"]); // not a vaccine
    expect(await send({}, b)).toEqual(["NOT_FOUND"]); // another organisation's batch
    expect(await db.vaccination.count()).toBe(0);

    expect(await send({})).toEqual(["applied"]);
    expect(await send({})).toEqual(["ALREADY_EXISTS"]);
    expect((await pulled()).map((v) => [v.dueOn, v.productId, v.method, v.done])).toEqual([
      ["2026-10-25", "vaccine-newcastle", "spray", null],
      ["2026-11-08", "vaccine-gumboro", "drinkingWater", null],
      ["2026-11-08", "vaccine-infectious-bronchitis", "drinkingWater", null],
      ["2026-11-09", "vaccine-newcastle", "drinkingWater", null],
    ]);
    expect((await pulled()).map((v) => v.id)).toEqual(plan.map((v) => v.id)); // the phone's ids
    expect((await pull(b, 0, registry)).changes.filter((c) => c.entity === "vaccination")).toEqual([]);
    expect(await db.auditEvent.count({ where: { entity: "VaccinationPlan", organizationId: a.organizationId } })).toBe(1);
  });

  it("H2 + S4: a vaccination done takes its doses out of the lot, once, and only from a lot of that vaccine", async () => {
    expect(await statuses(a, [done(0, feed), done(0, gumboroLot), done(0, newcastleLot, 0)])).toEqual(["WRONG_STOCK_ITEM", "WRONG_STOCK_ITEM", "INVALID_INPUT"]);
    expect(await statuses(b, [done(0, newcastleLot)])).toEqual(["NOT_FOUND"]);
    expect(await statuses(a, [done(0, newcastleLot, 990, "2026-10-24")])).toEqual(["DAY_BEFORE_PLACEMENT"]);
    expect(await db.stockMovement.count({ where: { id: plan[0].id } })).toBe(0);

    expect(await statuses(a, [done(0, newcastleLot)])).toEqual(["applied"]);
    expect(await statuses(a, [done(0, newcastleLot)])).toEqual(["ALREADY_DONE"]);
    const changes = (await pull(a, 0, registry)).changes;
    const movements = changes.filter((c) => c.entity === "movement").map((c) => c.data as MovementDto);
    expect(stockOnHand(movements).get(newcastleLot)).toBe(4010); // 5 000 − 990
    expect(movements.find((x) => x.id === plan[0].id)).toMatchObject({ kind: "consumption", quantity: -990, day: "2026-10-25" });
    expect((await pulled()).findLast((v) => v.id === plan[0].id)?.done).toEqual({ on: "2026-10-25", stockItemId: newcastleLot, doses: 990, method: "spray", byUserId: a.userId });
    expect(await db.auditEvent.count({ where: { entity: "Vaccination", entityId: plan[0].id } })).toBe(1);
  });

  it("H2: reminds the day before and on the due day, once each, held until the end of quiet hours, never for a vaccination done", async () => {
    expect(await statuses(a, [done(1, gumboroLot, 980, "2026-11-07")])).toEqual(["applied"]); // given a day early
    const inbox = () => db.notification.findMany({ where: { userId: a.userId }, orderBy: { templateKey: "asc" } });

    // Shortly after midnight on 8 November, farm time: line 2 is due today, line 3 tomorrow; line 1 is done.
    expect(await sendVaccinationReminders(fixedClock("2026-11-08T01:00:00Z"))).toBe(2);
    const sixAm = farmInstant("2026-11-08" as FarmDay, 6 * 60).toISOString(); // the end of the default quiet hours
    expect((await inbox()).map((n) => [n.templateKey, n.params, n.deliverAfter.toISOString()])).toEqual([
      ["vaccineToday", { vaccineFr: "Vaccin BI", vaccineAr: "لقاح", house: "Bâtiment 1", age: "14", method: "drinkingWater" }, sixAm],
      ["vaccineTomorrow", { vaccineFr: "Vaccin Newcastle", vaccineAr: "لقاح نيوكاسل", house: "Bâtiment 1", age: "15", method: "drinkingWater" }, sixAm],
    ]);
    expect(await sendVaccinationReminders(fixedClock("2026-11-08T09:00:00Z"))).toBe(0); // the same day again: nothing new

    expect(await sendVaccinationReminders(fixedClock("2026-11-09T07:00:00Z"))).toBe(1); // line 3, on its day
    expect((await inbox()).map((n) => n.templateKey)).toEqual(["vaccineToday", "vaccineToday", "vaccineTomorrow"]);
    expect(await db.notification.count({ where: { organizationId: b.organizationId } })).toBe(0);
  });
});
