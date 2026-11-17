import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { farmMinutesOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { CLIMATE_MUTATIONS as M } from "@/modules/climate/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
// HH:MM on the farm clock (Africa/Casablanca from the zone database, never a fixed offset).
const farmClock = (iso: string) => {
  const m = farmMinutesOf(new Date(iso));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("power cuts (SPEC-m4 CL5)", () => {
  let a: TenantContext, b: TenantContext;
  const farm = uuidv7();
  const start = (id: string, at = "2026-11-03T14:20:00+01:00") => m(M.startPowerCut, { id, farmId: farm, startedAt: at });
  const end = (id: string, at = "2026-11-03T15:05:00+01:00") => m(M.endPowerCut, { id, endedAt: at, generatorStarted: true, generatorSeconds: 40, dieselMl: 18_000 });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await push(a, [m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null })], registry);
  });

  it("a worker starts a cut (owners and managers are told), then ends it with the generator's details", async () => {
    const worker = { ...a, role: "worker" as const };
    const id = uuidv7();
    expect(await statuses(worker, [start(id)])).toEqual(["applied"]);
    expect(await db.notification.findMany({ where: { organizationId: a.organizationId, templateKey: "powerCut" } })).toMatchObject([{ userId: a.userId, urgent: true, params: { time: farmClock("2026-11-03T14:20:00+01:00") } }]);
    expect(await statuses(worker, [end(id)])).toEqual(["applied"]);
    expect((await pull(a, 0, registry)).changes.filter((c) => c.id === id).at(-1)?.data).toEqual({
      id, farmId: farm, startedAt: "2026-11-03T13:20:00.000Z", endedAt: "2026-11-03T14:05:00.000Z", generatorStarted: true, generatorSeconds: 40, dieselMl: 18_000,
    });
    expect(await statuses(worker, [end(id)])).toEqual(["errors.ALREADY_DONE"]);
  });

  it("one open cut per farm; the power can't come back before it went; other organisations can't touch it", async () => {
    const [first, second] = [uuidv7(), uuidv7()];
    expect(await statuses(a, [start(first), start(second)])).toEqual(["applied", "errors.POWER_CUT_OPEN"]);
    expect(await statuses(b, [end(first)])).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(b, [m(M.startPowerCut, { id: uuidv7(), farmId: farm, startedAt: "2026-11-04T10:00:00+01:00" })])).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(a, [end(first, "2026-11-03T14:00:00+01:00")])).toEqual(["errors.CUT_END_BEFORE_START"]);
    expect(await statuses(a, [end(first), start(second)])).toEqual(["applied", "applied"]);
  });
});
