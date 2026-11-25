import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { withoutMoney } from "@/lib/permissions";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmBelongsTo, houseOf } from "@/modules/farm-registry";
import { memberByPhone, PhoneNumber } from "@/modules/identity";
import { CreateEmployee, EMPLOYEE_PRIVATE, UpdateEmployee, WORKFORCE_MUTATIONS as M, type EmployeeDto, type EmployeeFields } from "@/modules/workforce/schema";

// SPEC-m4 WF1–WF3: employees, written offline by owners and managers. Light module: Prisma and rules here.

type EmployeeRow = Omit<EmployeeDto, "startedOn" | "leftOn" | "dailyWageCentimes" | "job"> & {
  job: string;
  startedOn: Date;
  leftOn: Date | null;
  dailyWageCentimes: bigint;
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const date = (d: string) => new Date(`${d}T00:00:00Z`); // a calendar date

const employeeDto = (r: EmployeeRow): EmployeeDto => ({
  id: r.id,
  farmId: r.farmId,
  name: r.name,
  job: r.job as EmployeeDto["job"],
  userId: r.userId,
  housedOnFarm: r.housedOnFarm,
  startedOn: day(r.startedOn),
  leftOn: r.leftOn && day(r.leftOn),
  houseIds: r.houseIds,
  phone: r.phone,
  dailyWageCentimes: String(r.dailyWageCentimes),
  cnssNumber: r.cnssNumber,
});

/** Checks the changed fields against the farm and turns them into columns; the phone links the member (WF2). */
async function columns(tx: Tx, ctx: TenantContext, id: string, farmId: string, f: Partial<EmployeeFields>, startedOn: string) {
  const { phone, startedOn: s, leftOn, dailyWageCentimes, houseIds, ...plain } = f;
  if (leftOn && leftOn < (s ?? startedOn)) return fail("LEFT_BEFORE_START");
  if (houseIds && (await Promise.all(houseIds.map((h) => houseOf(tx, ctx, h)))).some((h) => h?.farmId !== farmId)) return fail("NOT_FOUND");
  let link = {};
  if (phone !== undefined) {
    const number = phone === null ? null : PhoneNumber.create(phone);
    if (number && !number.ok) return fail("INVALID_PHONE");
    const userId = number ? await memberByPhone(tx, ctx.organizationId, number.value.e164) : null;
    if (userId && (await tx.employee.findFirst({ where: { farmId, userId, id: { not: id } }, select: { id: true } }))) return fail("MEMBER_ALREADY_LINKED");
    link = { phone: number ? number.value.e164 : null, userId };
  }
  return ok({
    ...plain,
    ...link,
    ...(s !== undefined && { startedOn: date(s) }),
    ...(leftOn !== undefined && { leftOn: leftOn && date(leftOn) }),
    ...(dailyWageCentimes !== undefined && { dailyWageCentimes: BigInt(dailyWageCentimes) }),
    ...(houseIds !== undefined && { houseIds: [...new Set(houseIds)] }),
  });
}

const pick = <T extends object>(obj: T, keys: string[]) => Object.fromEntries(keys.map((k) => [k, obj[k as keyof T]]));

async function save(tx: Tx, ctx: TenantContext, dto: EmployeeDto, action: "create" | "update", meta: object, before?: object): Promise<Result<void>> {
  await recordChange(tx, ctx, "employee", dto.id, dto);
  await audit(tx, ctx, { entity: "Employee", entityId: dto.id, action, before, after: dto, ...meta });
  return ok(undefined);
}

export const employeesSync: SyncRegistry = {
  mutations: {
    [M.createEmployee]: defineMutation({
      schema: CreateEmployee,
      action: "workforce.manage",
      async apply(tx, ctx, { id, farmId, ...fields }, meta) {
        if (!(await farmBelongsTo(tx, ctx, farmId))) return fail("NOT_FOUND");
        if (await tx.employee.findUnique({ where: { id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        const cols = await columns(tx, ctx, id, farmId, fields, fields.startedOn);
        if (!cols.ok) return cols;
        const row = await tx.employee.create({ data: { name: fields.name, job: fields.job, housedOnFarm: fields.housedOnFarm, phone: null, ...cols.value, startedOn: date(fields.startedOn), dailyWageCentimes: BigInt(fields.dailyWageCentimes), id, farmId, organizationId: ctx.organizationId } });
        return save(tx, ctx, employeeDto(row), "create", meta);
      },
    }),
    // Last write received wins, field by field; marking someone as left is setting `leftOn` (WF1).
    [M.updateEmployee]: defineMutation({
      schema: UpdateEmployee,
      action: "workforce.manage",
      async apply(tx, ctx, { id, changes }, meta) {
        const row = await tx.employee.findFirst({ where: { id, organizationId: ctx.organizationId } });
        if (!row) return fail("NOT_FOUND");
        const cols = await columns(tx, ctx, id, row.farmId, changes, day(row.startedOn));
        if (!cols.ok) return cols;
        const dto = employeeDto(await tx.employee.update({ where: { id }, data: cols.value }));
        return save(tx, ctx, dto, "update", meta, pick(employeeDto(row), Object.keys(changes)));
      },
    }),
  },
  // WF3: workers see who works where, never wages, phones or CNSS numbers.
  entities: { employee: (ctx, data: EmployeeDto) => withoutMoney(ctx, data, EMPLOYEE_PRIVATE) },
};
