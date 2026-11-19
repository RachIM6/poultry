import { describe, expect, it } from "vitest";
import { monthEnd, payFor, rulesOn, type LabourRules } from "@/modules/workforce/domain/pay";

// Made-up figures to exercise the arithmetic, NOT Moroccan rates or the SMAG: those come from the owner's source (MQ2).
const rules = (r: Partial<LabourRules> = {}): LabourRules => ({ id: "01", validFrom: "2026-01-01", source: "test", smagDailyCentimes: "10000", employeeCappedBp: 400, employeeUncappedBp: 200, employerCappedBp: 800, employerUncappedBp: 1000, monthlyCapCentimes: "300000", ...r });
const days = (n: number, status = "present") => Array.from({ length: n }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, status }));
const said = { id: "said", dailyWageCentimes: "15000" };

describe("monthly pay (SPEC-m4 WF11)", () => {
  it("gross = daily wage × (present + leave) days of that month only; advances of that month deducted", () => {
    const statuses = [...days(20), ...days(2, "leave").map((d, i) => ({ ...d, day: `2026-10-2${i + 1}` })), { day: "2026-10-25", status: "rest" }, { day: "2026-10-26", status: "absent" }, { day: "2026-11-01", status: "present" }];
    const line = payFor("2026-10", said, statuses, [{ deductMonth: "2026-10", amountCentimes: "100000" }, { deductMonth: "2026-11", amountCentimes: "50000" }], null);
    expect(line).toEqual({ employeeId: "said", paidDays: 22, grossCentimes: "330000", advancesCentimes: "100000", employeeContributionCentimes: null, employerContributionCentimes: null, netCentimes: "230000", belowSmag: null });
  });

  it("with rules: capped and uncapped parts, rounded half up to the centime, and the SMAG check", () => {
    // gross 330 000; capped part 300 000. Employee: 4 % × 300 000 + 2 % × 330 000 = 12 000 + 6 600. Employer: 24 000 + 33 000.
    const line = payFor("2026-10", said, days(22), [], rules());
    expect(line).toMatchObject({ employeeContributionCentimes: "18600", employerContributionCentimes: "57000", netCentimes: "311400", belowSmag: false });
    expect(payFor("2026-10", { id: "x", dailyWageCentimes: "9999" }, days(1), [], rules()).belowSmag).toBe(true);
    // 1 day of 333 centimes × 2 % = 6.66 → 7; × 4 % = 13.32 → 13
    expect(payFor("2026-10", { id: "x", dailyWageCentimes: "333" }, days(1), [], rules()).employeeContributionCentimes).toBe("20");
  });

  it("incomplete rules compute no contribution; a SMAG alone still checks the wage", () => {
    expect(payFor("2026-10", said, days(1), [], rules({ monthlyCapCentimes: null }))).toMatchObject({ employeeContributionCentimes: null, belowSmag: false });
    expect(payFor("2026-10", said, days(1), [], rules({ smagDailyCentimes: null })).belowSmag).toBeNull();
  });

  it("the rules in force on the month's last day", () => {
    const all = [rules({ id: "01", validFrom: "2026-01-01" }), rules({ id: "02", validFrom: "2026-10-15", smagDailyCentimes: "20000" })];
    expect(rulesOn(all, monthEnd("2026-09"))?.id).toBe("01");
    expect(rulesOn(all, monthEnd("2026-10"))?.id).toBe("02");
    expect(rulesOn(all, "2025-12-31")).toBeNull();
    expect(monthEnd("2028-02")).toBe("2028-02-29");
  });
});
