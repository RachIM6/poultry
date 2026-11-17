import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { attendanceId, WORKFORCE_MUTATIONS as M } from "@/modules/workforce/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("attendance (SPEC-m4 WF9)", () => {
  let a: TenantContext, b: TenantContext, said: TenantContext, khalid: TenantContext;
  const [farm, saidId, khalidId] = [uuidv7(), uuidv7(), uuidv7()];
  const today = farmDayOf(new Date());
  const checkIn = (employeeId: string, time = "06:30", day = today) => ({ id: attendanceId(employeeId, day), employeeId, day, time });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    const member = async (phone: string) => {
      const user = await db.user.create({ data: { phoneNumber: phone, name: phone, email: `${phone.slice(1)}@phone.invalid` } });
      await db.membership.create({ data: { organizationId: a.organizationId, userId: user.id, role: "worker" } });
      return { ...a, userId: user.id, role: "worker" as const };
    };
    [said, khalid] = await Promise.all([member("+212612340001"), member("+212612340002")]);
    const employee = (id: string, phone: string) => ({ id, farmId: farm, name: phone, job: "worker", phone, housedOnFarm: true, startedOn: "2026-01-01", leftOn: null, dailyWageCentimes: "13846", cnssNumber: null, houseIds: [] });
    await push(a, [m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }), m(M.createEmployee, employee(saidId, "+212612340001")), m(M.createEmployee, employee(khalidId, "+212612340002"))], registry);
  });

  it("a worker checks in for their own employee only; checking in twice keeps the first time", async () => {
    expect(await statuses(said, [m(M.checkIn, checkIn(khalidId))])).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(said, [m(M.checkIn, checkIn(saidId)), m(M.checkIn, checkIn(saidId, "07:10"))])).toEqual(["applied", "applied"]);
    expect(await db.attendance.findUniqueOrThrow({ where: { id: attendanceId(saidId, today) } })).toMatchObject({ status: "present", arrivedAt: "06:30" });
    const tomorrow = farmDayOf(new Date(Date.now() + 86_400_000));
    expect(await statuses(said, [m(M.checkIn, checkIn(saidId, "06:30", tomorrow))])).toEqual(["errors.DAY_IN_FUTURE"]);
    const yesterday = farmDayOf(new Date(Date.now() - 86_400_000));
    expect(await statuses(said, [m(M.checkIn, checkIn(saidId, "06:30", yesterday))])).toEqual(["errors.INVALID_INPUT"]); // not the day the phone recorded it
  });

  it("the manager sets any day; workers pull only their own days, other organisations nothing", async () => {
    const day = "2026-11-02";
    expect(await statuses(said, [m(M.setAttendance, { id: attendanceId(khalidId, day), employeeId: khalidId, day, status: "absent", arrivedAt: null })])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses({ ...a, role: "manager" }, [m(M.setAttendance, { id: attendanceId(khalidId, day), employeeId: khalidId, day, status: "leave", arrivedAt: "07:00" })])).toEqual(["applied"]);
    expect(await db.attendance.findUniqueOrThrow({ where: { id: attendanceId(khalidId, day) } })).toMatchObject({ status: "leave", arrivedAt: null });

    const seen = async (ctx: TenantContext) => (await pull(ctx, 0, registry)).changes.filter((c) => c.entity === "attendance").map((c) => (c.data as { employeeId: string }).employeeId);
    expect(await seen(said)).toEqual([saidId]);
    expect(await seen(khalid)).toEqual([khalidId]);
    expect((await seen(a)).sort()).toEqual([saidId, khalidId].sort());
    expect(await seen(b)).toEqual([]);
    expect(await statuses(b, [m(M.setAttendance, { id: attendanceId(saidId, day), employeeId: saidId, day, status: "absent", arrivedAt: null })])).toEqual(["errors.NOT_FOUND"]);
  });
});
