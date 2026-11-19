import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { WORKFORCE_MUTATIONS as M } from "@/modules/workforce/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-17T09:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const farmOf = (ctx: TenantContext) => {
  const [farm, house] = [uuidv7(), uuidv7()];
  return {
    farm,
    house,
    pushed: push(ctx, [
      m("farm-registry.createFarm", { id: farm, name: "El Kheir", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m("farm-registry.createHouse", { id: house, farmId: farm, name: "Bât. 2", areaM2: 1000, capacity: 10000, type: "closed" }),
    ], registry),
  };
};

describe("routines and one-off tasks through sync (SPEC-m4 WF5)", () => {
  let a: TenantContext, b: TenantContext;
  let A: ReturnType<typeof farmOf>, B: ReturnType<typeof farmOf>;
  beforeAll(async () => {
    [a, b] = await twoTenants();
    [A, B] = [farmOf(a), farmOf(b)];
    await Promise.all([A.pushed, B.pushed]);
  });
  const routine = (over: object = {}) => ({ id: uuidv7(), farmId: A.farm, houseId: A.house, employeeId: null, title: "Pesée de 100 sujets", time: "14:00", everyDays: 7, startOn: null, fromAge: 7, stopOn: null, ...over });

  it("a routine saved, then stopped by a manager, reaches every member as saved; a replay changes nothing", async () => {
    const manager = { ...a, role: "manager" as const };
    const r = routine();
    const saved = m(M.saveRoutine, r);
    expect(await statuses(manager, [saved, saved])).toEqual(["applied", "applied"]);
    expect(await statuses(manager, [m(M.saveRoutine, { ...r, stopOn: "2026-12-01" })])).toEqual(["applied"]);
    const seen = (await pull({ ...a, role: "worker" }, 0, registry)).changes.filter((c) => c.id === r.id).map((c) => c.data);
    expect(seen).toEqual([r, { ...r, stopOn: "2026-12-01" }]);
    expect(await db.auditEvent.count({ where: { entity: "Routine", entityId: r.id } })).toBe(2);
  });

  it("a routine is either from a calendar day or from a batch age with a house", async () => {
    expect(await statuses(a, [m(M.saveRoutine, routine({ startOn: "2026-11-01" }))])).toEqual(["errors.INVALID_INPUT"]);
    expect(await statuses(a, [m(M.saveRoutine, routine({ fromAge: null }))])).toEqual(["errors.INVALID_INPUT"]);
    expect(await statuses(a, [m(M.saveRoutine, routine({ houseId: null }))])).toEqual(["errors.INVALID_INPUT"]);
    expect(await statuses(a, [m(M.saveRoutine, routine({ houseId: null, fromAge: null, startOn: "2026-11-01" }))])).toEqual(["applied"]);
  });

  it("one-off tasks are added once and cancelled; workers can't do either", async () => {
    const task = { id: uuidv7(), farmId: A.farm, houseId: null, employeeId: null, day: "2026-11-17", title: "Recevoir le camion d’aliment", time: "09:00" };
    const worker = { ...a, role: "worker" as const };
    expect(await statuses(worker, [m(M.addTask, task)])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(a, [m(M.addTask, task), m(M.addTask, task)])).toEqual(["applied", "errors.ALREADY_EXISTS"]);
    expect(await statuses(worker, [m(M.cancelTask, { id: task.id })])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(a, [m(M.cancelTask, { id: task.id })])).toEqual(["applied"]);
    expect((await pull(a, 0, registry)).changes.filter((c) => c.id === task.id).at(-1)?.data).toEqual({ ...task, cancelled: true });
  });

  it("never touches another organisation's farm, house, employee, routine or task", async () => {
    const r = routine();
    await push(a, [m(M.saveRoutine, r)], registry);
    const task = { id: uuidv7(), farmId: A.farm, houseId: null, employeeId: null, day: "2026-11-17", title: "x", time: null };
    await push(a, [m(M.addTask, task)], registry);
    const employee = uuidv7();
    await push(b, [m(M.createEmployee, { id: employee, farmId: B.farm, name: "E", job: "worker", phone: null, housedOnFarm: false, startedOn: "2026-01-01", leftOn: null, dailyWageCentimes: "1", cnssNumber: null, houseIds: [] })], registry);

    expect(
      await statuses(b, [
        m(M.saveRoutine, { ...r, farmId: B.farm, houseId: B.house }), // a's routine id
        m(M.saveRoutine, routine({ farmId: B.farm })), // a's house
        m(M.cancelTask, { id: task.id }),
        m(M.addTask, { ...task, id: uuidv7() }), // a's farm
      ]),
    ).toEqual(["errors.NOT_FOUND", "errors.NOT_FOUND", "errors.NOT_FOUND", "errors.NOT_FOUND"]);
    expect(await statuses(a, [m(M.addTask, { ...task, id: uuidv7(), employeeId: employee })])).toEqual(["errors.NOT_FOUND"]); // b's employee
    expect((await pull(b, 0, registry)).changes.some((c) => c.id === r.id || c.id === task.id)).toBe(false);
  });
});
