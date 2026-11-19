import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import { farmBelongsTo } from "@/modules/farm-registry";
import { AddStaffRecord, monthEnd, payFor, payMonthId, RecordAdvance, rulesOn, SaveLabourRules, ValidatePay, WORKFORCE_MUTATIONS as M, type AdvanceDto, type LabourRules, type PayMonthDto, type StaffRecordDto } from "@/modules/workforce/schema";

// SPEC-m4 WF10–WF13: advances, pay, trainings and accidents. Money: owners and managers only, never sent to workers (SPEC I5).

const clock: Clock = systemClock;
const date = (d: string) => new Date(`${d}T00:00:00Z`); // a calendar date
const iso = (d: Date) => d.toISOString().slice(0, 10);

type RulesRow = Omit<LabourRules, "validFrom" | "smagDailyCentimes" | "monthlyCapCentimes"> & { validFrom: Date; smagDailyCentimes: bigint | null; monthlyCapCentimes: bigint | null };
const rulesDto = (r: RulesRow): LabourRules => ({
  id: r.id,
  validFrom: iso(r.validFrom),
  source: r.source,
  smagDailyCentimes: r.smagDailyCentimes === null ? null : String(r.smagDailyCentimes),
  employeeCappedBp: r.employeeCappedBp,
  employeeUncappedBp: r.employeeUncappedBp,
  employerCappedBp: r.employerCappedBp,
  employerUncappedBp: r.employerUncappedBp,
  monthlyCapCentimes: r.monthlyCapCentimes === null ? null : String(r.monthlyCapCentimes),
});

/** WF12: once the owner validated a farm's month, its attendance and advances stay as they were paid. */
export const monthValidated = async (tx: Tx, farmId: string, month: string) => (await tx.payMonth.count({ where: { farmId, month } })) > 0;

export const paySync: SyncRegistry = {
  mutations: {
    [M.recordAdvance]: defineMutation({
      schema: RecordAdvance,
      action: "workforce.manage",
      async apply(tx, ctx, a, meta) {
        const employee = await tx.employee.findFirst({ where: { id: a.employeeId, organizationId: ctx.organizationId }, select: { farmId: true } });
        if (!employee) return fail("NOT_FOUND");
        if (await monthValidated(tx, employee.farmId, a.deductMonth)) return fail("PAY_MONTH_VALIDATED");
        if (await tx.salaryAdvance.findUnique({ where: { id: a.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        await tx.salaryAdvance.create({ data: { ...a, day: new Date(`${a.day}T00:00:00Z`), amountCentimes: BigInt(a.amountCentimes), farmId: employee.farmId, organizationId: ctx.organizationId, recordedBy: ctx.userId } });
        const dto: AdvanceDto = { ...a, farmId: employee.farmId };
        await recordChange(tx, ctx, "advance", a.id, dto);
        await audit(tx, ctx, { entity: "SalaryAdvance", entityId: a.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    // WF13: recorded once, never edited (MQ6: no declaration rule built in).
    [M.addStaffRecord]: defineMutation({
      schema: AddStaffRecord,
      action: "workforce.manage",
      async apply(tx, ctx, r, meta) {
        const employee = await tx.employee.findFirst({ where: { id: r.employeeId, organizationId: ctx.organizationId }, select: { farmId: true } });
        if (!employee) return fail("NOT_FOUND");
        if (r.day > farmDayOf(clock.now())) return fail("DAY_IN_FUTURE");
        if (await tx.staffRecord.findUnique({ where: { id: r.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        const dto: StaffRecordDto = { topic: null, daysOff: null, ...r, farmId: employee.farmId };
        await tx.staffRecord.create({ data: { ...dto, day: date(dto.day), organizationId: ctx.organizationId, recordedBy: ctx.userId } });
        await recordChange(tx, ctx, "staffRecord", dto.id, dto);
        await audit(tx, ctx, { entity: "StaffRecord", entityId: dto.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    // §2, MQ2: the owner enters the labour figures from a source; each save is a new dated version, never edited.
    [M.saveLabourRules]: defineMutation({
      schema: SaveLabourRules,
      action: "labour.manage",
      async apply(tx, ctx, r, meta) {
        if (await tx.labourRules.findUnique({ where: { id: r.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        const big = (v: string | null) => (v === null ? null : BigInt(v));
        await tx.labourRules.create({ data: { ...r, validFrom: date(r.validFrom), smagDailyCentimes: big(r.smagDailyCentimes), monthlyCapCentimes: big(r.monthlyCapCentimes), organizationId: ctx.organizationId, createdBy: ctx.userId } });
        await recordChange(tx, ctx, "labourRules", r.id, r);
        await audit(tx, ctx, { entity: "LabourRules", entityId: r.id, action: "create", after: r, ...meta });
        return ok(undefined);
      },
    }),
    // WF12: the owner freezes a month's pay, computed here from the server's records (never the phone's figures).
    [M.validatePay]: defineMutation({
      schema: ValidatePay,
      action: "workforce.validatePay",
      async apply(tx, ctx, { farmId, month }, meta) {
        if (!(await farmBelongsTo(tx, ctx, farmId))) return fail("NOT_FOUND");
        if (month > farmDayOf(clock.now()).slice(0, 7)) return fail("DAY_IN_FUTURE");
        if (await monthValidated(tx, farmId, month)) return fail("PAY_MONTH_VALIDATED");
        const [from, to] = [date(`${month}-01`), date(monthEnd(month))];
        const [employees, days, advances, rules] = await Promise.all([
          tx.employee.findMany({ where: { farmId, organizationId: ctx.organizationId, startedOn: { lte: to }, OR: [{ leftOn: null }, { leftOn: { gt: from } }] }, orderBy: { name: "asc" } }),
          tx.attendance.findMany({ where: { farmId, organizationId: ctx.organizationId, day: { gte: from, lte: to } } }),
          tx.salaryAdvance.findMany({ where: { farmId, organizationId: ctx.organizationId, deductMonth: month } }),
          tx.labourRules.findMany({ where: { organizationId: ctx.organizationId } }),
        ]);
        const inForce = rulesOn(rules.map(rulesDto), monthEnd(month));
        const lines = employees.map((e) =>
          payFor(
            month,
            { id: e.id, dailyWageCentimes: String(e.dailyWageCentimes) },
            days.filter((d) => d.employeeId === e.id).map((d) => ({ day: iso(d.day), status: d.status })),
            advances.filter((a) => a.employeeId === e.id).map((a) => ({ deductMonth: a.deductMonth, amountCentimes: String(a.amountCentimes) })),
            inForce,
          ),
        );
        const dto: PayMonthDto = { id: payMonthId(farmId, month), farmId, month, lines, rulesId: inForce?.id ?? null, validatedOn: farmDayOf(clock.now()), validatedBy: ctx.userId };
        await tx.payMonth.create({ data: { ...dto, lines: dto.lines, validatedOn: date(dto.validatedOn), organizationId: ctx.organizationId } });
        await recordChange(tx, ctx, "payMonth", dto.id, dto);
        await audit(tx, ctx, { entity: "PayMonth", entityId: dto.id, action: "validate", after: dto, ...meta });
        return ok(undefined);
      },
    }),
  },
  // A worker's phone receives no advance at all, theirs included (W-Staff "Droits").
  entities: {
    advance: (ctx, data: AdvanceDto) => (can(ctx, "money.read") ? data : undefined),
    payMonth: (ctx, data: PayMonthDto) => (can(ctx, "money.read") ? data : undefined),
    labourRules: (ctx, data: LabourRules) => (can(ctx, "money.read") ? data : undefined),
    staffRecord: (ctx, data: StaffRecordDto) => (can(ctx, "workforce.manage") ? data : undefined), // a worker: not even their own
  },
};
