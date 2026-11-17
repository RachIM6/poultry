import { audit } from "@/lib/audit";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import { CheckIn, SetAttendance, WORKFORCE_MUTATIONS as M, type AttendanceDto } from "@/modules/workforce/schema";

// SPEC-m4 WF9: who was on the farm each day. A linked worker checks in on their phone; the owner or a manager sets
// any day's status. Offline: the id is the same on every phone for one employee and day.

const clock: Clock = systemClock;
const OFFLINE_DAYS = 7; // SPEC X1: a check-in made offline may reach the server up to a week later
const date = (d: string) => new Date(`${d}T00:00:00Z`);

type Row = { id: string; farmId: string; employeeId: string; day: Date; status: string; arrivedAt: string | null; userId: string | null };
const dto = (r: Row): AttendanceDto => ({ id: r.id, farmId: r.farmId, employeeId: r.employeeId, day: r.day.toISOString().slice(0, 10), status: r.status as AttendanceDto["status"], arrivedAt: r.arrivedAt, userId: r.userId });

export const attendanceSync: SyncRegistry = {
  mutations: {
    // A worker for their own employee record only; checking in twice keeps the first time (and a manager's status).
    [M.checkIn]: defineMutation({
      schema: CheckIn,
      action: "workforce.record",
      async apply(tx, ctx, c, meta) {
        const employee = await tx.employee.findFirst({ where: { id: c.employeeId, organizationId: ctx.organizationId } });
        if (!employee || employee.userId !== ctx.userId) return fail("NOT_FOUND");
        const today = farmDayOf(clock.now());
        if (c.day > today) return fail("DAY_IN_FUTURE");
        if (c.day < addFarmDays(today, -OFFLINE_DAYS)) return fail("TASK_DAY_PAST");
        // A self check-in is for the day the phone recorded it (its clock, kept in the audit log), never another day.
        if (c.day !== farmDayOf(meta.deviceCreatedAt)) return fail("INVALID_INPUT");
        if (date(c.day) < employee.startedOn || (employee.leftOn && date(c.day) >= employee.leftOn)) return fail("EMPLOYEE_NOT_ACTIVE");
        const existing = await tx.attendance.findUnique({ where: { id: c.id } });
        if (existing) return existing.organizationId === ctx.organizationId ? ok(undefined) : fail("NOT_FOUND");
        const row = await tx.attendance.create({ data: { id: c.id, employeeId: c.employeeId, day: date(c.day), status: "present", arrivedAt: c.time, farmId: employee.farmId, userId: employee.userId, organizationId: ctx.organizationId, updatedBy: ctx.userId } });
        await recordChange(tx, ctx, "attendance", row.id, dto(row));
        await audit(tx, ctx, { entity: "Attendance", entityId: row.id, action: "create", after: dto(row), ...meta });
        return ok(undefined);
      },
    }),
    [M.setAttendance]: defineMutation({
      schema: SetAttendance,
      action: "workforce.manage",
      async apply(tx, ctx, s, meta) {
        const employee = await tx.employee.findFirst({ where: { id: s.employeeId, organizationId: ctx.organizationId } });
        if (!employee) return fail("NOT_FOUND");
        if (s.day > farmDayOf(clock.now())) return fail("DAY_IN_FUTURE");
        const before = await tx.attendance.findUnique({ where: { id: s.id } });
        if (before && before.organizationId !== ctx.organizationId) return fail("NOT_FOUND");
        const fields = { status: s.status, arrivedAt: s.status === "present" ? s.arrivedAt : null, updatedBy: ctx.userId };
        const row = await tx.attendance.upsert({
          where: { id: s.id },
          create: { id: s.id, employeeId: s.employeeId, day: date(s.day), farmId: employee.farmId, userId: employee.userId, organizationId: ctx.organizationId, ...fields },
          update: fields,
        });
        await recordChange(tx, ctx, "attendance", row.id, dto(row));
        await audit(tx, ctx, { entity: "Attendance", entityId: row.id, action: before ? "update" : "create", before: before && dto(before), after: dto(row), ...meta });
        return ok(undefined);
      },
    }),
  },
  // WF9: a worker sees their own days (the check-in chip); owners and managers everyone's.
  entities: { attendance: (ctx, data: AttendanceDto) => (can(ctx, "workforce.manage") || data.userId === ctx.userId ? data : undefined) },
};
