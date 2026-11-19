import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { attendanceId, payMonthId, WORKFORCE_MUTATIONS as M, type PayMonthDto } from "@/modules/workforce/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

// Made-up figures, NOT Moroccan rates or the SMAG (SPEC-m4 MQ2).
const rules = (over: object = {}) => ({ id: uuidv7(), validFrom: "2026-01-01", source: "Test, not a real circular", smagDailyCentimes: "10000", employeeCappedBp: 400, employeeUncappedBp: 200, employerCappedBp: 800, employerUncappedBp: 1000, monthlyCapCentimes: "300000", ...over });

describe("labour rules and monthly pay (SPEC-m4 WF11, WF12, §2)", () => {
  let a: TenantContext, b: TenantContext;
  const [farm, said] = [uuidv7(), uuidv7()];
  const day = (d: string, status = "present") => m(M.setAttendance, { id: attendanceId(said, d), employeeId: said, day: d, status, arrivedAt: null });
  const payOf = async (ctx: TenantContext, month: string) => (await pull(ctx, 0, registry)).changes.find((c) => c.id === payMonthId(farm, month))?.data as PayMonthDto | undefined;

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await push(a, [
      m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m(M.createEmployee, { id: said, farmId: farm, name: "Said A.", job: "worker", phone: null, housedOnFarm: true, startedOn: "2026-01-01", leftOn: null, dailyWageCentimes: "15000", cnssNumber: null, houseIds: [] }),
      day("2026-09-01"), day("2026-09-02"), day("2026-09-03", "leave"), day("2026-09-04", "absent"),
      m(M.recordAdvance, { id: uuidv7(), employeeId: said, day: "2026-09-02", amountCentimes: "5000", deductMonth: "2026-09", note: null }),
    ], registry);
  });

  it("without rules, the validated month has days, gross and advances, and no contribution", async () => {
    expect(await statuses({ ...a, role: "manager" }, [m(M.validatePay, { farmId: farm, month: "2026-09" })])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(a, [m(M.validatePay, { farmId: farm, month: "2026-09" })])).toEqual(["applied"]);
    expect((await payOf(a, "2026-09"))?.lines).toEqual([
      { employeeId: said, paidDays: 3, grossCentimes: "45000", advancesCentimes: "5000", employeeContributionCentimes: null, employerContributionCentimes: null, netCentimes: "40000", belowSmag: null },
    ]);
  });

  it("a validated month is frozen: its attendance, advances and validation can't change", async () => {
    expect(await statuses(a, [day("2026-09-05")])).toEqual(["errors.PAY_MONTH_VALIDATED"]);
    expect(await statuses(a, [m(M.recordAdvance, { id: uuidv7(), employeeId: said, day: "2026-09-10", amountCentimes: "1", deductMonth: "2026-09", note: null })])).toEqual(["errors.PAY_MONTH_VALIDATED"]);
    expect(await statuses(a, [m(M.validatePay, { farmId: farm, month: "2026-09" })])).toEqual(["errors.PAY_MONTH_VALIDATED"]);
  });

  it("the owner's rules, in force on the month's last day, give contributions; only the owner enters them", async () => {
    expect(await statuses({ ...a, role: "manager" }, [m("workforce.saveLabourRules", rules())])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(a, [m("workforce.saveLabourRules", rules({ source: "" }))])).toEqual(["errors.INVALID_INPUT"]);
    expect(await statuses(a, [m("workforce.saveLabourRules", rules()), day("2026-10-01")])).toEqual(["applied", "applied"]);
    expect(await statuses(a, [m(M.validatePay, { farmId: farm, month: "2026-10" })])).toEqual(["applied"]);
    expect((await payOf(a, "2026-10"))?.lines[0]).toMatchObject({ grossCentimes: "15000", employeeContributionCentimes: "900", employerContributionCentimes: "2700", netCentimes: "14100", belowSmag: false });
  });

  it("workers and other organisations see no pay and no rules, and can't validate", async () => {
    const pulled = (await pull({ ...a, role: "worker" }, 0, registry)).changes.map((c) => c.entity);
    expect(pulled).not.toContain("payMonth");
    expect(pulled).not.toContain("labourRules");
    expect(await payOf(b, "2026-09")).toBeUndefined();
    expect(await statuses(b, [m(M.validatePay, { farmId: farm, month: "2026-11" })])).toEqual(["errors.NOT_FOUND"]);
  });
});
