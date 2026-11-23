import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { flockSync } from "@/modules/flock";
import { FLOCK_MUTATIONS as F } from "@/modules/flock/schema";
import { healthSync, sendVaccinationReminders } from "@/modules/health";
import { HEALTH_MUTATIONS as H, planFor, type VaccinationDto } from "@/modules/health/schema";
import { inventorySync } from "@/modules/inventory";
import { INVENTORY_MUTATIONS as I } from "@/modules/inventory/schema";
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

describe("editing a batch's vaccination plan (SPEC H1, H2, SPEC-m5 PA4)", () => {
  let a: TenantContext, b: TenantContext, vet: TenantContext, manager: TenantContext, worker: TenantContext, accountant: TenantContext;
  const [farm, house, batch, protocol, supplier, newcastleLot] = Array.from({ length: 6 }, () => uuidv7());
  const plan = planFor(batch, PLACED_ON, [...ITEMS]);
  const added = uuidv7(); // a line the vet adds by hand
  const add = (payload: object = {}) => m(H.addVaccination, { id: added, batchId: batch, dayOfAge: 20, productId: "vaccine-gumboro", method: "drinkingWater", ...payload });
  const move = (line: number, dayOfAge: number) => m(H.moveVaccination, { id: plan[line].id, dayOfAge });
  const cancel = (id: string) => m(H.cancelVaccination, { id });
  // the latest change per line, as a phone ends up with it
  const lines = async () => new Map((await pull(a, 0, registry)).changes.filter((c) => c.entity === "vaccination").map((c) => [c.id, c.data as VaccinationDto | null]));

  beforeAll(async () => {
    [a, b] = await twoTenants();
    [vet, manager, worker, accountant] = (["vet", "manager", "worker", "accountant"] as const).map((role) => ({ ...a, role }));
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
    await db.vaccinationProtocol.create({ data: { id: protocol, organizationId: a.organizationId, name: "Programme", items: [...ITEMS] } });
    expect(
      await statuses(a, [
        m(I.createSupplier, { id: supplier, name: "Véto", phone: null }),
        m(I.createStockItem, { id: newcastleLot, farmId: farm, productId: "vaccine-newcastle", kind: "vaccine", name: "ND", unit: "dose", lot: "L1", expiresOn: "2027-06-30" }),
        m(I.recordPurchase, { id: uuidv7(), movementId: uuidv7(), supplierId: supplier, stockItemId: newcastleLot, day: PLACED_ON, quantity: 5000, unitPriceCentimes: "20", paidCentimes: "0", dueOn: null }),
        m(F.placeBatch, { id: batch, houseId: house, strainId: "ross-308", placedOn: PLACED_ON, chicksPlaced: 1000, deadOnArrival: 10, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null }),
        m(H.planVaccinations, { batchId: batch, protocolId: protocol, items: ITEMS }),
        m(H.recordVaccination, { id: plan[0].id, on: PLACED_ON, stockItemId: newcastleLot, doses: 990, method: "spray" }), // line 0 given
      ]),
    ).toEqual(Array(6).fill("applied"));
  });

  it("only those who manage health (owner, manager, vet) edit the plan; workers and the accountant are refused", async () => {
    for (const ctx of [worker, accountant]) expect(await statuses(ctx, [add(), move(1, 16), cancel(plan[2].id)])).toEqual(["FORBIDDEN", "FORBIDDEN", "FORBIDDEN"]);
    expect(await db.vaccination.count({ where: { batchId: batch } })).toBe(4);
    expect(await statuses(manager, [move(3, 15)])).toEqual(["applied"]); // the same day: nothing changes but the audit
  });

  it("adds a vaccine of the catalogue by hand, with the phone's id, once, in its own organisation", async () => {
    expect(await statuses(vet, [add({ productId: "feed-starter" })])).toEqual(["INVALID_INPUT"]); // not a vaccine
    expect(await statuses(vet, [add({ productId: "vaccine-made-up" })])).toEqual(["INVALID_INPUT"]); // not in the catalogue
    expect(await statuses(vet, [add({ dayOfAge: -1 })])).toEqual(["INVALID_INPUT"]);
    expect(await statuses(b, [add()])).toEqual(["NOT_FOUND"]); // another organisation's batch

    const sent = add();
    expect(await statuses(vet, [sent, sent])).toEqual(["applied", "applied"]); // the same mutation again: its stored result
    expect(await statuses(vet, [add()])).toEqual(["ALREADY_EXISTS"]); // another mutation reusing the id

    expect((await lines()).get(added)).toEqual({ id: added, batchId: batch, dayOfAge: 20, dueOn: "2026-11-14", productId: "vaccine-gumboro", method: "drinkingWater", done: null });
    expect(await db.vaccination.findUnique({ where: { id: added } })).toMatchObject({ organizationId: a.organizationId, protocolId: null });
    expect(await db.auditEvent.count({ where: { entity: "Vaccination", entityId: added, action: "add" } })).toBe(1);
    expect((await pull(b, 0, registry)).changes.filter((c) => c.entity === "vaccination")).toEqual([]);
  });

  it("moves a line not yet done to another day of age, never a line given or another organisation's", async () => {
    expect(await statuses(vet, [move(0, 2)])).toEqual(["ALREADY_DONE"]);
    expect(await statuses(b, [move(1, 16)])).toEqual(["NOT_FOUND"]);

    const sent = move(1, 16);
    expect(await statuses(vet, [sent, sent])).toEqual(["applied", "applied"]); // replayed: applied once
    expect((await lines()).get(plan[1].id)).toMatchObject({ dayOfAge: 16, dueOn: "2026-11-10", done: null });
    expect(await db.auditEvent.findMany({ where: { entityId: plan[1].id, action: "move" }, select: { before: true, after: true } })).toEqual([
      { before: { dayOfAge: 14, dueOn: "2026-11-08" }, after: { dayOfAge: 16, dueOn: "2026-11-10" } },
    ]);
    expect((await lines()).get(plan[0].id)).toMatchObject({ dueOn: "2026-10-25", done: { on: "2026-10-25" } }); // untouched
  });

  it("cancels a line not yet done: the phones delete it, the audit keeps it; a line given stays", async () => {
    expect(await statuses(vet, [cancel(plan[0].id)])).toEqual(["ALREADY_DONE"]);
    expect(await statuses(b, [cancel(plan[2].id)])).toEqual(["NOT_FOUND"]);

    const sent = cancel(plan[2].id);
    expect(await statuses(vet, [sent, sent])).toEqual(["applied", "applied"]); // replayed: applied once
    expect(await statuses(vet, [cancel(plan[2].id)])).toEqual(["NOT_FOUND"]); // already gone
    expect(await statuses(vet, [m(H.recordVaccination, { id: plan[2].id, on: "2026-11-01", stockItemId: newcastleLot, doses: 10, method: "spray" })])).toEqual(["NOT_FOUND"]);

    const latest = await lines();
    expect(latest.get(plan[2].id)).toBeNull(); // a deletion for every phone
    expect(latest.get(plan[0].id)?.done).not.toBeNull();
    expect(await db.vaccination.count({ where: { id: plan[2].id } })).toBe(0);
    expect(await db.auditEvent.findMany({ where: { entityId: plan[2].id, action: "cancel" }, select: { before: true } })).toEqual([{ before: { ...plan[2], done: null } }]);
  });

  it("H2: reminders follow the plan as edited: none for a cancelled line, the new day for a moved one, again after a second move", async () => {
    const sent = async () =>
      (await db.notification.findMany({ where: { userId: a.userId } })).map((n) => [n.templateKey, (n.params as { vaccineFr: string }).vaccineFr, (n.params as { age: string }).age].join(" ")).sort();

    // 8 November: line 1 (moved off this day) and line 2 (cancelled) were due today; line 3 is due tomorrow.
    expect(await sendVaccinationReminders(fixedClock("2026-11-08T07:00:00Z"))).toBe(1);
    expect(await sent()).toEqual(["vaccineTomorrow Vaccin Newcastle 15"]);

    // 9 November: line 3 today, line 1 tomorrow on its new day. Then line 1 moves again, after its first reminder.
    expect(await sendVaccinationReminders(fixedClock("2026-11-09T07:00:00Z"))).toBe(2);
    expect(await statuses(manager, [move(1, 18), move(3, 15)])).toEqual(["applied", "applied"]); // line 3: the same day
    expect(await sendVaccinationReminders(fixedClock("2026-11-09T09:00:00Z"))).toBe(0); // line 3 isn't announced twice

    // 11 November: line 1, now due on the 12th, is announced again; 13 November: the line added by hand, due the 14th.
    expect(await sendVaccinationReminders(fixedClock("2026-11-11T07:00:00Z"))).toBe(1);
    expect(await sendVaccinationReminders(fixedClock("2026-11-13T07:00:00Z"))).toBe(1);
    expect(await sent()).toEqual([
      "vaccineToday Vaccin Newcastle 15",
      "vaccineTomorrow Vaccin Gumboro 16",
      "vaccineTomorrow Vaccin Gumboro 18",
      "vaccineTomorrow Vaccin Gumboro 20",
      "vaccineTomorrow Vaccin Newcastle 15",
    ]);
  });

  it("a closed batch's plan no longer changes", async () => {
    await db.batch.update({ where: { id: batch }, data: { status: "closed" } }); // closing itself is flock's (B6)
    const addLate = m(H.addVaccination, { id: uuidv7(), batchId: batch, dayOfAge: 30, productId: "vaccine-gumboro", method: "spray" });
    expect(await statuses(vet, [addLate, move(3, 20), cancel(plan[3].id)])).toEqual(["BATCH_CLOSED", "BATCH_CLOSED", "BATCH_CLOSED"]);
    expect(await db.vaccination.count({ where: { batchId: batch } })).toBe(4); // lines 0, 1, 3 and the one added
  });
});
