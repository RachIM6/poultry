import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { taskAssignmentId, taskKey, WORKFORCE_MUTATIONS as M } from "@/modules/workforce/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-17T09:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const employee = (id: string, farmId: string, over: object = {}) => ({ id, farmId, name: "E", job: "worker", phone: null, housedOnFarm: false, startedOn: "2026-01-01", leftOn: null, dailyWageCentimes: "1", cnssNumber: null, houseIds: [], ...over });
const farm = (id: string) => ({ id, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null });

describe("giving one day's task to someone else (SPEC-m4 WF7)", () => {
  let a: TenantContext, b: TenantContext;
  const [farmA, farmB, said, hamid, left, foreign] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const key = taskKey.entry(uuidv7());
  const day = "2026-11-17";
  const assign = (employeeId: string, over: object = {}) => ({ id: taskAssignmentId(a.organizationId, key, day), farmId: farmA, key, day, employeeId, ...over });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await push(a, [m("farm-registry.createFarm", farm(farmA)), m(M.createEmployee, employee(said, farmA)), m(M.createEmployee, employee(hamid, farmA)), m(M.createEmployee, employee(left, farmA, { leftOn: "2026-11-01" }))], registry);
    await push(b, [m("farm-registry.createFarm", farm(farmB)), m(M.createEmployee, employee(foreign, farmB))], registry);
  });

  it("one record per task and day: the last assignment wins, and every member pulls it", async () => {
    expect(await statuses({ ...a, role: "manager" }, [m(M.assignTask, assign(said)), m(M.assignTask, assign(hamid))])).toEqual(["applied", "applied"]);
    expect(await db.taskAssignment.findMany({ where: { key } })).toMatchObject([{ employeeId: hamid }]);
    const pulled = (await pull({ ...a, role: "worker" }, 0, registry)).changes.filter((c) => c.entity === "taskAssignment").at(-1)?.data;
    expect(pulled).toEqual(assign(hamid));
  });

  it("refuses workers, employees who left or of another farm, other organisations, and a made-up id", async () => {
    expect(await statuses({ ...a, role: "worker" }, [m(M.assignTask, assign(said))])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(a, [m(M.assignTask, assign(left))])).toEqual(["errors.EMPLOYEE_NOT_ACTIVE"]);
    expect(await statuses(a, [m(M.assignTask, assign(foreign))])).toEqual(["errors.NOT_FOUND"]);
    // The id carries the organisation: b can neither use a's id nor, with its own, touch a's record.
    expect(await statuses(b, [m(M.assignTask, assign(foreign, { farmId: farmB }))])).toEqual(["errors.INVALID_INPUT"]);
    expect(await statuses(b, [m(M.assignTask, assign(foreign, { farmId: farmB, id: taskAssignmentId(b.organizationId, key, day) }))])).toEqual(["applied"]);
    expect(await db.taskAssignment.findUniqueOrThrow({ where: { id: taskAssignmentId(a.organizationId, key, day) } })).toMatchObject({ employeeId: hamid });
    expect(await statuses(a, [m(M.assignTask, assign(said, { id: uuidv7() }))])).toEqual(["errors.INVALID_INPUT"]);
  });
});
