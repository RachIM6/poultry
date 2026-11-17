// SPEC-m4 WF11, §2: one employee's pay for a month. No labour-law figure is built in: the SMAG, the contribution rates
// and the cap come from a dated `LabourRules` version the owner entered with its source (MQ2). Without one, the pay is
// days, gross and advances only. Money in integer centimes; rates in basis points (1 % = 100).

type Day = string;
type Month = string; // YYYY-MM

export type LabourRules = {
  id: string;
  validFrom: Day;
  source: string;
  smagDailyCentimes: string | null; // the farm minimum wage per day
  employeeCappedBp: number | null; // on gross pay up to the monthly cap
  employeeUncappedBp: number | null; // on all gross pay
  employerCappedBp: number | null;
  employerUncappedBp: number | null;
  monthlyCapCentimes: string | null;
};

/** The version in force on a day: the latest `validFrom` on or before it. */
export const rulesOn = (all: LabourRules[], day: Day): LabourRules | null =>
  all.filter((r) => r.validFrom <= day).sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.id.localeCompare(b.id)).at(-1) ?? null;

/** Last day of a month, YYYY-MM-DD. */
export const monthEnd = (month: Month) => `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;

export type PayLine = {
  employeeId: string;
  paidDays: number; // ⚠️ MQ2: present + leave
  grossCentimes: string;
  advancesCentimes: string;
  employeeContributionCentimes: string | null; // null: rules not entered
  employerContributionCentimes: string | null;
  netCentimes: string; // gross − employee contribution (when known) − advances
  belowSmag: boolean | null; // null: SMAG not entered
};

// ⚠️ MQ2: rounding to the centime, half up, per contribution.
const pct = (base: bigint, bp: number) => (base * BigInt(bp) + 5_000n) / 10_000n;

export function payFor(
  month: Month,
  employee: { id: string; dailyWageCentimes: string },
  statuses: { day: Day; status: string }[],
  advances: { deductMonth: Month; amountCentimes: string }[],
  rules: LabourRules | null,
): PayLine {
  const paidDays = statuses.filter((s) => s.day.startsWith(`${month}-`) && (s.status === "present" || s.status === "leave")).length;
  const wage = BigInt(employee.dailyWageCentimes);
  const gross = wage * BigInt(paidDays);
  const advance = advances.filter((a) => a.deductMonth === month).reduce((n, a) => n + BigInt(a.amountCentimes), 0n);
  const r = rules;
  const complete = r !== null && r.monthlyCapCentimes !== null && [r.employeeCappedBp, r.employeeUncappedBp, r.employerCappedBp, r.employerUncappedBp].every((x) => x !== null);
  const capped = complete ? (gross < BigInt(r.monthlyCapCentimes!) ? gross : BigInt(r.monthlyCapCentimes!)) : 0n;
  const share = (cappedBp: number | null, uncappedBp: number | null) => (complete ? pct(capped, cappedBp!) + pct(gross, uncappedBp!) : null);
  const employeePart = share(r?.employeeCappedBp ?? null, r?.employeeUncappedBp ?? null);
  const employerPart = share(r?.employerCappedBp ?? null, r?.employerUncappedBp ?? null);
  return {
    employeeId: employee.id,
    paidDays,
    grossCentimes: String(gross),
    advancesCentimes: String(advance),
    employeeContributionCentimes: employeePart === null ? null : String(employeePart),
    employerContributionCentimes: employerPart === null ? null : String(employerPart),
    netCentimes: String(gross - (employeePart ?? 0n) - advance),
    belowSmag: r?.smagDailyCentimes ? wage < BigInt(r.smagDailyCentimes) : null,
  };
}
