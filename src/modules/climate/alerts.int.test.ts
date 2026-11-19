import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { CLIMATE_MUTATIONS as M } from "@/modules/climate/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });

// SPEC-m4 CL4. Made-up targets, NOT husbandry figures (MQ1).
describe("climate alerts (SPEC-m4 CL4)", () => {
  let a: TenantContext, manager: TenantContext;
  const [farm, house, empty] = [uuidv7(), uuidv7(), uuidv7()];
  const today = farmDayOf(new Date());
  const reading = (over: object = {}) => ({ id: uuidv7(), houseId: house, day: today, time: "14:00", temperatureTenths: 150, humidity: 50, ammonia: null, ...over });
  const alerts = () => db.notification.findMany({ where: { organizationId: a.organizationId, templateKey: "climateOutOfRange" } });

  beforeAll(async () => {
    [a] = await twoTenants();
    const user = await db.user.create({ data: { phoneNumber: "+212600000099", name: "Hamid", email: "hamid@phone.invalid" } });
    await db.membership.create({ data: { organizationId: a.organizationId, userId: user.id, role: "manager" } });
    manager = { ...a, userId: user.id, role: "manager" };
    await push(a, [
      m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m("farm-registry.createHouse", { id: house, farmId: farm, name: "Bât. 2", areaM2: 1000, capacity: 10000, type: "closed" }),
      m("farm-registry.createHouse", { id: empty, farmId: farm, name: "Bât. 3", areaM2: 1000, capacity: 10000, type: "closed" }),
    ], registry);
    await db.batch.create({ data: { id: uuidv7(), organizationId: a.organizationId, farmId: farm, houseId: house, strainId: "ross-308", placedOn: new Date(`${addFarmDays(today, -31)}T00:00:00Z`), chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: 450n } });
  });

  it("without targets, nobody is alerted", async () => {
    await push(a, [m(M.recordReading, reading({ temperatureTenths: 400 }))], registry);
    expect(await alerts()).toEqual([]);
  });

  it("an out-of-range reading alerts the owner and the manager once, urgently; a replay and an in-range reading don't", async () => {
    await push(a, [m(M.saveTargets, { id: uuidv7(), validFrom: "2026-01-01", source: "Test", bands: [{ fromAge: 30, toAge: 35, temperatureMinTenths: 100, temperatureMaxTenths: 200, humidityMin: null, humidityMax: null, ammoniaMax: null }] })], registry);
    const hot = m(M.recordReading, reading({ temperatureTenths: 245, humidity: 68 }));
    await push({ ...a, role: "worker" }, [hot, hot, m(M.recordReading, reading())], registry);
    const sent = await alerts();
    expect(sent.map((n) => n.userId).sort()).toEqual([a.userId, manager.userId].sort());
    expect(sent[0]).toMatchObject({ urgent: true, params: { house: "Bât. 2", age: "31", values: "24,5 °C · 68 %" } });
  });

  it("a house with no batch that day alerts nobody", async () => {
    const before = (await alerts()).length;
    await push(a, [m(M.recordReading, reading({ houseId: empty, temperatureTenths: 450 }))], registry);
    expect(await alerts()).toHaveLength(before);
  });
});
