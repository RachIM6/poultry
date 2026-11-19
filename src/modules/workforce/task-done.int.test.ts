import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { taskDoneId, taskKey, WORKFORCE_MUTATIONS as M } from "@/modules/workforce/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-17T09:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("ticking a task done (SPEC-m4 WF6)", () => {
  let a: TenantContext, b: TenantContext, worker: TenantContext;
  const [farm, routine] = [uuidv7(), uuidv7()];
  const today = farmDayOf(new Date());
  const key = taskKey.routine(routine);
  const tick = (day = today) => ({ id: taskDoneId(key, day), farmId: farm, key, day });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    worker = { ...a, role: "worker" };
    await push(a, [
      m("farm-registry.createFarm", { id: farm, name: "El Kheir", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m(M.saveRoutine, { id: routine, farmId: farm, houseId: null, employeeId: null, title: "Abreuvoirs", time: null, everyDays: 1, startOn: "2026-01-01", fromAge: null, stopOn: null }),
    ], registry);
  });

  it("a worker ticks a routine; two phones ticking the same task and day store one completion", async () => {
    expect(await statuses(worker, [m(M.tickTask, tick()), m(M.tickTask, tick())])).toEqual(["applied", "applied"]);
    expect(await db.taskDone.count({ where: { key } })).toBe(1);
    const pulled = (await pull(worker, 0, registry)).changes.filter((c) => c.entity === "taskDone");
    expect(pulled.map((c) => c.data)).toEqual([{ ...tick(), byUserId: a.userId }]);
  });

  it("unticks the same farm day only, and only the caller's organisation", async () => {
    expect(await statuses(b, [m(M.untickTask, { id: tick().id })])).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(worker, [m(M.untickTask, { id: tick().id })])).toEqual(["applied"]);
    expect(await db.taskDone.count({ where: { key } })).toBe(0);
    expect((await pull(a, 0, registry)).changes.filter((c) => c.entity === "taskDone").at(-1)?.data).toBeNull(); // tombstone

    const yesterday = new Date(Date.now() - 86_400_000);
    expect(await statuses(worker, [m(M.tickTask, tick(farmDayOf(yesterday)))])).toEqual(["applied"]);
    expect(await statuses(worker, [m(M.untickTask, { id: tick(farmDayOf(yesterday)).id })])).toEqual(["errors.TASK_DAY_PAST"]);
  });

  it("refuses a future day, an unknown or foreign task, and entry or vaccine tasks (done by recording them)", async () => {
    const tomorrow = farmDayOf(new Date(Date.now() + 86_400_000));
    expect(await statuses(worker, [m(M.tickTask, tick(tomorrow))])).toEqual(["errors.DAY_IN_FUTURE"]);
    const other = taskKey.routine(uuidv7());
    expect(await statuses(worker, [m(M.tickTask, { ...tick(), id: taskDoneId(other, today), key: other })])).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(b, [m(M.tickTask, tick())])).toEqual(["errors.NOT_FOUND"]);
    const entry = taskKey.entry(uuidv7());
    expect(await statuses(worker, [m(M.tickTask, { ...tick(), id: taskDoneId(entry, today), key: entry })])).toEqual(["errors.INVALID_INPUT"]);
    expect(await statuses(worker, [m(M.tickTask, { ...tick(), id: uuidv7() })])).toEqual(["errors.INVALID_INPUT"]); // id not from key + day
    const loose = `${key}:x`;
    expect(await statuses(worker, [m(M.tickTask, { ...tick(), id: taskDoneId(loose, today), key: loose })])).toEqual(["errors.INVALID_INPUT"]);
  });

  it("ticks only a day the task fell on, within the offline week, and a worker takes back only their own tick", async () => {
    const eightDaysAgo = farmDayOf(new Date(Date.now() - 8 * 86_400_000));
    expect(await statuses(worker, [m(M.tickTask, tick(eightDaysAgo))])).toEqual(["errors.TASK_DAY_PAST"]);

    const oneOff = uuidv7();
    const tomorrow = farmDayOf(new Date(Date.now() + 86_400_000));
    await push(a, [m(M.addTask, { id: oneOff, farmId: farm, houseId: null, employeeId: null, day: tomorrow, title: "Camion", time: null })], registry);
    const k = taskKey.oneoff(oneOff);
    expect(await statuses(worker, [m(M.tickTask, { id: taskDoneId(k, today), farmId: farm, key: k, day: today })])).toEqual(["errors.NOT_FOUND"]); // it falls tomorrow

    const user = await db.user.create({ data: { phoneNumber: "+212611112222", name: "Khalid", email: "k2@phone.invalid" } });
    const other = { ...a, userId: user.id, role: "worker" as const };
    expect(await statuses(worker, [m(M.tickTask, tick())])).toEqual(["applied"]);
    expect(await statuses(other, [m(M.untickTask, { id: tick().id })])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses({ ...other, role: "manager" }, [m(M.untickTask, { id: tick().id })])).toEqual(["applied"]);
  });
});
