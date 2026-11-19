import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { farmDayOf, nextFarmDay } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { WORKFORCE_MUTATIONS as M } from "@/modules/workforce/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("trainings and work accidents (SPEC-m4 WF13)", () => {
  let a: TenantContext, b: TenantContext;
  const [farm, said] = [uuidv7(), uuidv7()];
  const training = (over: object = {}) => ({ id: uuidv7(), employeeId: said, day: "2026-11-04", kind: "training", topic: "biosecurity", note: null, ...over });
  const accident = (over: object = {}) => ({ id: uuidv7(), employeeId: said, day: "2026-11-05", kind: "accident", note: "Coupure à la main en réparant une mangeoire", daysOff: 2, ...over });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await push(a, [
      m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m(M.createEmployee, { id: said, farmId: farm, name: "Said A.", job: "worker", phone: null, housedOnFarm: true, startedOn: "2026-01-01", leftOn: null, dailyWageCentimes: "13846", cnssNumber: null, houseIds: [] }),
    ], registry);
  });

  it("a manager records a training and an accident once; owners and managers pull them, workers never", async () => {
    const [x, y] = [training(), accident()];
    expect(await statuses({ ...a, role: "manager" }, [m(M.addStaffRecord, x), m(M.addStaffRecord, y), m(M.addStaffRecord, x)])).toEqual(["applied", "applied", "errors.ALREADY_EXISTS"]);
    expect(await db.staffRecord.findUniqueOrThrow({ where: { id: y.id } })).toMatchObject({ kind: "accident", topic: null, daysOff: 2, farmId: farm });
    const pulled = (await pull(a, 0, registry)).changes;
    expect(pulled.find((c) => c.id === x.id)?.data).toEqual({ ...x, farmId: farm, daysOff: null });
    expect(pulled.find((c) => c.id === y.id)?.data).toEqual({ ...y, farmId: farm, topic: null });
    expect((await pull({ ...a, role: "worker" }, 0, registry)).changes.some((c) => c.entity === "staffRecord")).toBe(false);
  });

  it("refuses workers, a training without topic, an accident without what happened, a day ahead, other organisations", async () => {
    expect(await statuses({ ...a, role: "worker" }, [m(M.addStaffRecord, training())])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(a, [m(M.addStaffRecord, training({ topic: null })), m(M.addStaffRecord, accident({ note: " " })), m(M.addStaffRecord, accident({ daysOff: -1 }))])).toEqual([
      "errors.INVALID_INPUT",
      "errors.INVALID_INPUT",
      "errors.INVALID_INPUT",
    ]);
    expect(await statuses(a, [m(M.addStaffRecord, training({ day: nextFarmDay(nextFarmDay(farmDayOf(new Date()))) }))])).toEqual(["errors.DAY_IN_FUTURE"]);
    expect(await statuses(b, [m(M.addStaffRecord, training())])).toEqual(["errors.NOT_FOUND"]);
  });
});
