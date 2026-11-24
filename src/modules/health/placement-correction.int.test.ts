import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { FLOCK_MUTATIONS as F } from "@/modules/flock/schema";
import { sendVaccinationReminders } from "@/modules/health";
import { HEALTH_MUTATIONS as H, planFor, type VaccinationDto } from "@/modules/health/schema";
import { INVENTORY_MUTATIONS as I } from "@/modules/inventory/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-20T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));

// A made-up protocol, to test the mechanics only: NOT a vaccination schedule (the default one waits for a vet, OQ4).
const ITEMS = [
  { dayOfAge: 14, productId: "vaccine-newcastle", method: "spray" },
  { dayOfAge: 21, productId: "vaccine-gumboro", method: "drinkingWater" },
  { dayOfAge: 25, productId: "vaccine-newcastle", method: "drinkingWater" },
  { dayOfAge: 30, productId: "vaccine-gumboro", method: "drinkingWater" },
] as const;
// The correction's own rules use the real clock (no placement in the future), so the days are counted from today.
const today = farmDayOf(new Date());
const on = (days: number) => addFarmDays(today, days);
const at = (days: number) => fixedClock(`${on(days)}T07:00:00Z`); // morning on that farm day
const PLACED_ON = on(-20);

describe("a corrected placement day moves the batch's vaccination plan (SPEC B1, H2)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { a: { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), protocol: uuidv7() }, b: { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), protocol: uuidv7() } };
  const [supplier, lot] = [uuidv7(), uuidv7()];
  const plan = planFor(ids.a.batch, PLACED_ON, [...ITEMS]);
  const correct = (changes: object, batchId = ids.a.batch) => m(F.correctPlacement, { batchId, changes });
  // the latest change per line, as a phone ends up with it
  const lines = async (ctx: TenantContext) => new Map((await pull(ctx, 0, registry)).changes.filter((c) => c.entity === "vaccination").map((c) => [c.id, c.data as VaccinationDto]));
  // by day of age: the pull sends each line once, in the order of its latest change (ADR-014)
  const dueDays = async (ctx: TenantContext) =>
    [...(await lines(ctx)).values()].sort((x, y) => x.dayOfAge - y.dayOfAge).map((v) => [v.dayOfAge, v.dueOn, v.done?.on ?? null]);
  const sent = async (ctx: TenantContext) =>
    (await db.notification.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "asc" } })).map((n) => `${n.templateKey} ${(n.params as { age: string }).age}`);

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    await db.product.createMany({
      data: [
        { id: "vaccine-newcastle", kind: "vaccine", nameFr: "Vaccin Newcastle", nameAr: "لقاح نيوكاسل" },
        { id: "vaccine-gumboro", kind: "vaccine", nameFr: "Vaccin Gumboro", nameAr: "لقاح الجمبورو" },
      ],
    });
    for (const [ctx, x] of [[a, ids.a], [b, ids.b]] as const) {
      await db.farm.create({ data: { id: x.farm, organizationId: ctx.organizationId, name: "F", region: "R", province: "P", commune: "C" } });
      await db.house.create({ data: { id: x.house, organizationId: ctx.organizationId, farmId: x.farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } });
      await db.vaccinationProtocol.create({ data: { id: x.protocol, organizationId: ctx.organizationId, name: "Programme", items: [...ITEMS] } });
      expect(
        await statuses(ctx, [
          m(F.placeBatch, { id: x.batch, houseId: x.house, strainId: "ross-308", placedOn: PLACED_ON, chicksPlaced: 1000, deadOnArrival: 10, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null }),
          m(H.planVaccinations, { batchId: x.batch, protocolId: x.protocol, items: ITEMS }),
        ]),
      ).toEqual(["applied", "applied"]);
    }
    expect(
      await statuses(a, [
        m(I.createSupplier, { id: supplier, name: "Véto", phone: null }),
        m(I.createStockItem, { id: lot, farmId: ids.a.farm, productId: "vaccine-newcastle", kind: "vaccine", name: "ND", unit: "dose", lot: "L1", expiresOn: "2099-06-30" }),
        m(I.recordPurchase, { id: uuidv7(), movementId: uuidv7(), supplierId: supplier, stockItemId: lot, day: PLACED_ON, quantity: 5000, unitPriceCentimes: "20", paidCentimes: "0", dueOn: null }),
        m(H.recordVaccination, { id: plan[0].id, on: on(-5), stockItemId: lot, doses: 990, method: "spray" }), // day 14, given a day late
        m(H.moveVaccination, { id: plan[3].id, dayOfAge: 28 }), // moved by hand from day 30
      ]),
    ).toEqual(Array(5).fill("applied"));
  });

  it("before any correction: the plan as made, the first reminder out for day 21", async () => {
    expect(await dueDays(a)).toEqual([[14, on(-6), on(-5)], [21, on(1), null], [25, on(5), null], [28, on(8), null]]);
    expect(await sendVaccinationReminders(at(0))).toBe(2); // each organisation's day 21, due tomorrow
    expect(await sent(a)).toEqual(["vaccineTomorrow 21"]);
  });

  it("3 days later: the lines not yet done move 3 days (the one moved by hand too), the line given stays, all audited", async () => {
    const fix = correct({ placedOn: addFarmDays(PLACED_ON, 3) });
    expect(await statuses(a, [fix, fix])).toEqual(["applied", "applied"]); // replayed: its stored result, moved once
    expect(await dueDays(a)).toEqual([[14, on(-6), on(-5)], [21, on(4), null], [25, on(8), null], [28, on(11), null]]);
    expect(await db.auditEvent.count({ where: { entity: "Vaccination", action: "move", mutationId: fix.id } })).toBe(3);
    expect(await db.auditEvent.findFirst({ where: { entityId: plan[1].id, mutationId: fix.id }, select: { before: true, after: true } })).toEqual({
      before: { dayOfAge: 21, dueOn: on(1) },
      after: { dayOfAge: 21, dueOn: on(4) },
    });
  });

  it("H2: the reminder sent for the old day isn't sent again for it; the line is announced the day before its new day", async () => {
    expect(await sendVaccinationReminders(at(0))).toBe(0);
    expect(await sendVaccinationReminders(at(1))).toBe(1); // only the other organisation's day 21, due today
    expect(await sent(a)).toEqual(["vaccineTomorrow 21"]);
    expect(await sendVaccinationReminders(at(3))).toBe(1);
    expect(await sent(a)).toEqual(["vaccineTomorrow 21", "vaccineTomorrow 21"]);
  });

  it("2 days earlier: the lines move back 2 days and their reminders follow", async () => {
    expect(await statuses(a, [correct({ placedOn: addFarmDays(PLACED_ON, 1) })])).toEqual(["applied"]);
    expect(await dueDays(a)).toEqual([[14, on(-6), on(-5)], [21, on(2), null], [25, on(6), null], [28, on(9), null]]);
    expect(await sendVaccinationReminders(at(1))).toBe(1); // day 21, now due on day +2
    expect(await sendVaccinationReminders(at(2))).toBe(1); // and on its day
    expect(await sent(a)).toEqual(["vaccineTomorrow 21", "vaccineTomorrow 21", "vaccineTomorrow 21", "vaccineToday 21"]);
  });

  it("a correction that keeps the placement day moves nothing", async () => {
    const before = await db.auditEvent.count({ where: { entity: "Vaccination", action: "move" } });
    expect(await statuses(a, [correct({ hatchery: "Couvoir Souss" })])).toEqual(["applied"]);
    expect(await db.auditEvent.count({ where: { entity: "Vaccination", action: "move" } })).toBe(before);
    expect(await dueDays(a)).toEqual([[14, on(-6), on(-5)], [21, on(2), null], [25, on(6), null], [28, on(9), null]]);
  });

  it("another organisation's plan never moves, and it can't correct this one's batch", async () => {
    expect(await statuses(b, [correct({ placedOn: addFarmDays(PLACED_ON, 2) })])).toEqual(["NOT_FOUND"]);
    expect(await dueDays(a)).toEqual([[14, on(-6), on(-5)], [21, on(2), null], [25, on(6), null], [28, on(9), null]]);
    expect(await dueDays(b)).toEqual([[14, on(-6), null], [21, on(1), null], [25, on(5), null], [30, on(10), null]]);
    expect(await sent(b)).toEqual(["vaccineTomorrow 21", "vaccineToday 21"]);
  });

  it("B1: not after a vaccination already given: refused, nothing written, and a replay gives the same answer", async () => {
    const fix = correct({ placedOn: on(-4) }); // the day-14 line was given on day -5
    const changes = await db.change.count({ where: { organizationId: a.organizationId } });
    expect(await statuses(a, [fix, fix])).toEqual(["PLACEMENT_AFTER_HEALTH_RECORD", "PLACEMENT_AFTER_HEALTH_RECORD"]);
    expect(await statuses(a, [fix])).toEqual(["PLACEMENT_AFTER_HEALTH_RECORD"]);
    expect(await db.mutation.findUniqueOrThrow({ where: { id: fix.id }, select: { result: true } })).toEqual({ result: { status: "rejected", messageKey: "errors.PLACEMENT_AFTER_HEALTH_RECORD" } });
    // flock had corrected the batch before health refused: all of it rolled back
    expect((await db.batch.findUniqueOrThrow({ where: { id: ids.a.batch } })).placedOn.toISOString().slice(0, 10)).toBe(addFarmDays(PLACED_ON, 1));
    expect(await dueDays(a)).toEqual([[14, on(-6), on(-5)], [21, on(2), null], [25, on(6), null], [28, on(9), null]]);
    expect(await db.auditEvent.count({ where: { mutationId: fix.id } })).toBe(0);
    expect(await db.change.count({ where: { organizationId: a.organizationId } })).toBe(changes);
  });

  it("B1: on the day it was given, or before, the correction goes through", async () => {
    expect(await statuses(a, [correct({ placedOn: on(-5) })])).toEqual(["applied"]);
    expect(await dueDays(a)).toEqual([[14, on(-6), on(-5)], [21, on(16), null], [25, on(20), null], [28, on(23), null]]);
    expect(await statuses(a, [correct({ placedOn: on(-19) })])).toEqual(["applied"]);
  });

  it("B1: nor after a treatment started or a vet visit", async () => {
    const medicine = uuidv7();
    expect(
      await statuses(a, [
        m(I.createStockItem, { id: medicine, farmId: ids.a.farm, productId: null, kind: "medicine", name: "Antibiotique", unit: "ml", lot: "M1", expiresOn: "2099-06-30" }),
        m(I.recordPurchase, { id: uuidv7(), movementId: uuidv7(), supplierId: supplier, stockItemId: medicine, day: PLACED_ON, quantity: 2000, unitPriceCentimes: "10", paidCentimes: "0", dueOn: null }),
        m(H.recordTreatment, { id: uuidv7(), batchId: ids.a.batch, stockItemId: medicine, quantity: 100, dose: "1 ml par litre", startOn: on(-12), endOn: on(-10), reason: "Toux", prescriber: "Dr Alaoui", withdrawalDays: 5 }),
      ]),
    ).toEqual(Array(3).fill("applied"));
    expect(await statuses(a, [correct({ placedOn: on(-11) })])).toEqual(["PLACEMENT_AFTER_HEALTH_RECORD"]);
    expect(await statuses(a, [m(H.recordVetVisit, { id: uuidv7(), batchId: ids.a.batch, on: on(-14), vetName: "Dr Alaoui", notes: "" })])).toEqual(["applied"]);
    expect(await statuses(a, [correct({ placedOn: on(-13) })])).toEqual(["PLACEMENT_AFTER_HEALTH_RECORD"]);
    expect(await statuses(a, [correct({ placedOn: on(-14) })])).toEqual(["applied"]);
  });
});
