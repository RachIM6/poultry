import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { PushedMutation } from "@/lib/sync/protocol";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { sendPlacementReminders } from "@/modules/planning";
import { PLANNING_MUTATIONS as M } from "@/modules/planning/schema";
import { twoTenants } from "@/test/tenant";

// SPEC-m5 PL4 (T99): the day before a planned placement, owners and managers get one notification per plan; none for a
// cancelled or placed plan, none twice. Fixed clock: 2026-12-14 at 07:00 on the farm (06:00 UTC), the plans on the 15th.
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
const clock = fixedClock("2026-12-14T06:00:00Z");

describe("placement reminders (SPEC-m5 PL4)", () => {
  let a: TenantContext;
  const [farm, house] = [uuidv7(), uuidv7()];
  const plan = (over: object = {}) => ({ id: uuidv7(), houseId: house, placeOn: "2026-12-15", chicks: 10_000, strainId: "ross-308", hatchery: "Couvoir X", chickPriceCentimes: null, saleAge: 35, ...over });
  const tomorrow = plan();

  beforeAll(async () => {
    [a] = await twoTenants();
    const cancelled = plan();
    await push(a, [
      m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m("farm-registry.createHouse", { id: house, farmId: farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" }),
      m(M.savePlan, tomorrow),
      m(M.savePlan, cancelled),
      m(M.cancelPlan, { id: cancelled.id }),
      m(M.savePlan, plan({ placeOn: "2026-12-16" })), // not tomorrow
    ], registry);
    const worker = await db.user.create({ data: { phoneNumber: "+212613000001", name: "w", email: "212613000001@phone.invalid" } });
    await db.membership.create({ data: { organizationId: a.organizationId, userId: worker.id, role: "worker" } });
  });

  it("announces tomorrow's planned placement once, to owners and managers, not workers", async () => {
    expect(await sendPlacementReminders(clock)).toBe(1);
    expect(await sendPlacementReminders(clock)).toBe(0); // claimed: never twice
    const sent = await db.notification.findMany({ where: { organizationId: a.organizationId, templateKey: "placementTomorrow" } });
    expect(sent.map((n) => [n.userId, n.params])).toEqual([[a.userId, { house: "Bâtiment 1", chicks: "10000", hatchery: "Couvoir X" }]]);
  });

  it("says nothing for a plan placed before its day", async () => {
    const early = plan({ placeOn: "2026-12-15" });
    await push(a, [m(M.savePlan, early)], registry);
    await db.plannedBatch.update({ where: { id: early.id }, data: { status: "placed" } });
    expect(await sendPlacementReminders(clock)).toBe(0);
  });
});
