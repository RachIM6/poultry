import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { CLIMATE_MUTATIONS as M } from "@/modules/climate/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("climate readings through sync (SPEC-m4 CL2)", () => {
  let a: TenantContext, b: TenantContext;
  const [farm, house] = [uuidv7(), uuidv7()];
  const today = farmDayOf(new Date());
  const reading = (over: object = {}) => ({ id: uuidv7(), houseId: house, day: today, time: "14:00", temperatureTenths: 245, humidity: 68, ammonia: null, ...over });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await push(a, [
      m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m("farm-registry.createHouse", { id: house, farmId: farm, name: "Bât. 2", areaM2: 1000, capacity: 10000, type: "closed" }),
    ], registry);
  });

  it("a worker records a reading once; every member of the organisation pulls it as recorded", async () => {
    const worker = { ...a, role: "worker" as const };
    const r = reading();
    const pushed = m(M.recordReading, r);
    expect(await statuses(worker, [pushed, pushed, m(M.recordReading, r)])).toEqual(["applied", "applied", "errors.ALREADY_EXISTS"]);
    expect((await pull(a, 0, registry)).changes.find((c) => c.id === r.id)?.data).toEqual({ ...r, farmId: farm, byUserId: a.userId });
    expect((await pull(b, 0, registry)).changes.some((c) => c.id === r.id)).toBe(false);
  });

  it("refuses another organisation's house, a future day and values out of the input bounds", async () => {
    expect(await statuses(b, [m(M.recordReading, reading())])).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(a, [m(M.recordReading, reading({ day: farmDayOf(new Date(Date.now() + 2 * 86_400_000)) }))])).toEqual(["errors.DAY_IN_FUTURE"]);
    expect(await statuses(a, [m(M.recordReading, reading({ temperatureTenths: 601 })), m(M.recordReading, reading({ humidity: 101 })), m(M.recordReading, reading({ time: "25:00" }))])).toEqual([
      "errors.INVALID_INPUT",
      "errors.INVALID_INPUT",
      "errors.INVALID_INPUT",
    ]);
  });
});
