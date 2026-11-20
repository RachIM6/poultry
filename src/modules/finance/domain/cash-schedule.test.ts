import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { cashSchedule } from "@/modules/finance/domain/cash-schedule";

const today = "2026-11-20" as FarmDay;

describe("cashSchedule (F-Effects, the next weeks' cash)", () => {
  const weeks = cashSchedule(today, 1_000_000n, [
    { dueOn: "2026-11-10", amountCentimes: 200_000n, direction: "out" }, // overdue: counted this week
    { dueOn: "2026-11-24", amountCentimes: 500_000n, direction: "in" },
    { dueOn: "2026-11-30", amountCentimes: 1_600_000n, direction: "out" },
    { dueOn: "2027-01-15", amountCentimes: 999n, direction: "in" }, // beyond the horizon
  ]);

  it("splits the flows into weeks from today, overdue ones in the first", () => {
    expect(weeks.map((w) => [w.from, w.to, w.inCentimes, w.outCentimes])).toEqual([
      ["2026-11-20", "2026-11-26", 500_000n, 200_000n],
      ["2026-11-27", "2026-12-03", 0n, 1_600_000n],
      ["2026-12-04", "2026-12-10", 0n, 0n],
      ["2026-12-11", "2026-12-17", 0n, 0n],
    ]);
  });

  it("runs the cash forward and shows when it goes short", () => {
    expect(weeks.map((w) => w.afterCentimes)).toEqual([1_300_000n, -300_000n, -300_000n, -300_000n]);
  });
});
