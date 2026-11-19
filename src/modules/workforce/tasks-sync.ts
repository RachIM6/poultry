import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmBelongsTo, houseOf } from "@/modules/farm-registry";
import { AddTask, CancelTask, SaveRoutine, WORKFORCE_MUTATIONS as M, type OneOffTask, type Routine } from "@/modules/workforce/schema";

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
  },
  // No money in tasks: every member sees them (a worker needs the farm's whole list to see their own).
  entities: { routine: (_ctx, data: Routine) => data, oneOffTask: (_ctx, data: OneOffTask) => data },
};
