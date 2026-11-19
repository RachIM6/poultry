import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { addFarmDays, daysBetween, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { farmBelongsTo, houseOf } from "@/modules/farm-registry";
import { batchPlacedInHouseOn } from "@/modules/flock";
import { routineFalls } from "@/modules/workforce/domain/tasks";
import { AddTask, CancelTask, SaveRoutine, TickTask, UntickTask, WORKFORCE_MUTATIONS as M, type OneOffTask, type Routine, type TaskDoneDto } from "@/modules/workforce/schema";

// SPEC-m4 WF5: the manager's routines and one-off tasks, written offline. The day's list itself is computed (domain/tasks.ts).

const day = (d: Date | null) => d && d.toISOString().slice(0, 10);
const date = (d: string | null) => d && new Date(`${d}T00:00:00Z`); // a calendar date

type RoutineRow = Omit<Routine, "startOn" | "stopOn"> & { startOn: Date | null; stopOn: Date | null };
const routineDto = (r: RoutineRow): Routine => ({
  id: r.id,
  farmId: r.farmId,
  houseId: r.houseId,
  title: r.title,
  time: r.time,
  everyDays: r.everyDays,
  startOn: day(r.startOn),
  fromAge: r.fromAge,
  stopOn: day(r.stopOn),
  employeeId: r.employeeId,
});
type TaskRow = Omit<OneOffTask, "day"> & { day: Date };
const taskDto = (r: TaskRow): OneOffTask => ({ id: r.id, farmId: r.farmId, houseId: r.houseId, day: day(r.day)!, title: r.title, time: r.time, employeeId: r.employeeId, cancelled: r.cancelled });

/** The farm, house and employee a task names all belong to the caller's organisation, and to that farm. */
async function placed(tx: Tx, ctx: TenantContext, t: { farmId: string; houseId: string | null; employeeId: string | null }): Promise<Result<void>> {
  if (!(await farmBelongsTo(tx, ctx, t.farmId))) return fail("NOT_FOUND");
  if (t.houseId && (await houseOf(tx, ctx, t.houseId))?.farmId !== t.farmId) return fail("NOT_FOUND");
  if (t.employeeId && !(await tx.employee.findFirst({ where: { id: t.employeeId, farmId: t.farmId, organizationId: ctx.organizationId }, select: { id: true } }))) return fail("NOT_FOUND");
  return ok(undefined);
}

/**
 * WF6: the routine or one-off task a key names (`tickable` checked its shape), on that farm, in the caller's
 * organisation, and due that day: a tick can't be made up for a day the task didn't fall on.
 */
async function dueOn(tx: Tx, ctx: TenantContext, farmId: string, key: string, on: string) {
  const [kind, id] = key.split(":");
  const where = { id, farmId, organizationId: ctx.organizationId };
  if (kind === "oneoff") return (await tx.oneOffTask.count({ where: { ...where, day: date(on)!, cancelled: false } })) > 0;
  const row = await tx.routine.findFirst({ where });
  if (!row) return false;
  const placedOn = row.fromAge !== null && row.houseId ? await batchPlacedInHouseOn(tx, ctx, row.houseId, on) : null;
  return routineFalls(routineDto(row), on, placedOn ? daysBetween(placedOn, on as FarmDay) : null);
}
const doneDto = (r: { id: string; farmId: string; key: string; day: Date; byUserId: string }): TaskDoneDto => ({ id: r.id, farmId: r.farmId, key: r.key, day: day(r.day)!, byUserId: r.byUserId });

// SPEC X1: a phone may stay offline 7 days, so a tick may reach the server up to then; never earlier days.
const OFFLINE_DAYS = 7;

const clock: Clock = systemClock;

export const tasksSync: SyncRegistry = {
  mutations: {
    // Create or replace: a routine is small, and two managers editing one offline is rare. Stopping it is `stopOn`.
    [M.saveRoutine]: defineMutation({
      schema: SaveRoutine,
      action: "workforce.manage",
      async apply(tx, ctx, r, meta) {
        const before = await tx.routine.findUnique({ where: { id: r.id } });
        if (before && (before.organizationId !== ctx.organizationId || before.farmId !== r.farmId)) return fail("NOT_FOUND");
        const where = await placed(tx, ctx, r);
        if (!where.ok) return where;
        const data = { ...r, startOn: date(r.startOn), stopOn: date(r.stopOn), organizationId: ctx.organizationId };
        const dto = routineDto(await tx.routine.upsert({ where: { id: r.id }, create: data, update: data }));
        await recordChange(tx, ctx, "routine", dto.id, dto);
        await audit(tx, ctx, { entity: "Routine", entityId: dto.id, action: before ? "update" : "create", before: before && routineDto(before), after: dto, ...meta });
        return ok(undefined);
      },
    }),
    [M.addTask]: defineMutation({
      schema: AddTask,
      action: "workforce.manage",
      async apply(tx, ctx, t, meta) {
        if (await tx.oneOffTask.findUnique({ where: { id: t.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        const where = await placed(tx, ctx, t);
        if (!where.ok) return where;
        const dto = taskDto(await tx.oneOffTask.create({ data: { ...t, day: date(t.day)!, organizationId: ctx.organizationId } }));
        await recordChange(tx, ctx, "oneOffTask", dto.id, dto);
        await audit(tx, ctx, { entity: "OneOffTask", entityId: dto.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    [M.cancelTask]: defineMutation({
      schema: CancelTask,
      action: "workforce.manage",
      async apply(tx, ctx, { id }, meta) {
        const row = await tx.oneOffTask.findFirst({ where: { id, organizationId: ctx.organizationId } });
        if (!row) return fail("NOT_FOUND");
        const dto = taskDto(await tx.oneOffTask.update({ where: { id }, data: { cancelled: true } }));
        await recordChange(tx, ctx, "oneOffTask", id, dto);
        await audit(tx, ctx, { entity: "OneOffTask", entityId: id, action: "cancel", before: { cancelled: row.cancelled }, after: { cancelled: true }, ...meta });
        return ok(undefined);
      },
    }),
    // Any member ticks a task they can see; a second tick of the same task and day changes nothing.
    [M.tickTask]: defineMutation({
      schema: TickTask,
      action: "workforce.record",
      async apply(tx, ctx, t, meta) {
        const today = farmDayOf(clock.now());
        if (t.day > today) return fail("DAY_IN_FUTURE");
        if (t.day < addFarmDays(today, -OFFLINE_DAYS)) return fail("TASK_DAY_PAST");
        if (!(await dueOn(tx, ctx, t.farmId, t.key, t.day))) return fail("NOT_FOUND");
        const existing = await tx.taskDone.findUnique({ where: { id: t.id } });
        if (existing) return existing.organizationId === ctx.organizationId ? ok(undefined) : fail("NOT_FOUND");
        const dto = doneDto(await tx.taskDone.create({ data: { ...t, day: date(t.day)!, byUserId: ctx.userId, organizationId: ctx.organizationId } }));
        await recordChange(tx, ctx, "taskDone", dto.id, dto);
        await audit(tx, ctx, { entity: "TaskDone", entityId: dto.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    // A tick taken back the same farm day; earlier days are the record of what was done.
    [M.untickTask]: defineMutation({
      schema: UntickTask,
      action: "workforce.record",
      async apply(tx, ctx, { id }, meta) {
        const row = await tx.taskDone.findFirst({ where: { id, organizationId: ctx.organizationId } });
        if (!row) return fail("NOT_FOUND");
        if (day(row.day)! < farmDayOf(clock.now())) return fail("TASK_DAY_PAST");
        // A worker takes back their own tick only; owners and managers correct anyone's.
        if (row.byUserId !== ctx.userId && !can(ctx, "workforce.manage")) return fail("FORBIDDEN");
        await tx.taskDone.delete({ where: { id } });
        await recordChange(tx, ctx, "taskDone", id, null);
        await audit(tx, ctx, { entity: "TaskDone", entityId: id, action: "delete", before: doneDto(row), ...meta });
        return ok(undefined);
      },
    }),
  },
  // No money in tasks: every member sees them (a worker needs the farm's whole list to see their own).
  entities: { routine: (_ctx, data: Routine) => data, oneOffTask: (_ctx, data: OneOffTask) => data, taskDone: (_ctx, data: TaskDoneDto) => data },
};
