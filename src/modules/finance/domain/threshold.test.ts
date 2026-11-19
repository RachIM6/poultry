import { describe, expect, it } from "vitest";
import { thresholdOn, thresholdUsage, type Threshold } from "@/modules/finance/domain/threshold";

describe("5 M DH tracker (SPEC-finance FN17, §7)", () => {
  it("4 260 450 booked + 690 000 planned → 4 950 450; 99 %, with the alert", () => {
    expect(thresholdUsage(426_045_000n, 69_000_000n, 500_000_000n)).toEqual({ totalCentimes: 495_045_000n, percent: 99n, alert: true, over: false });
  });

  it("alerts from 90 %, and says when the threshold is reached", () => {
    expect(thresholdUsage(449_999_999n, 0n, 500_000_000n)).toMatchObject({ percent: 89n, alert: false });
    expect(thresholdUsage(450_000_000n, 0n, 500_000_000n)).toMatchObject({ percent: 90n, alert: true });
    expect(thresholdUsage(500_000_000n, 1n, 500_000_000n)).toMatchObject({ percent: 100n, over: true });
  });

  it("takes the threshold in force on the day: a new law adds an entry", () => {
    const list: Threshold[] = [
      { validFrom: "2026-01-01", centimes: 500_000_000n, ruleFr: "a", ruleAr: "a", source: "x" },
      { validFrom: "2028-01-01", centimes: 600_000_000n, ruleFr: "b", ruleAr: "b", source: "y" },
    ];
    expect(thresholdOn("2025-12-31", list)).toBeNull();
    expect(thresholdOn("2027-06-30", list)?.centimes).toBe(500_000_000n);
    expect(thresholdOn("2028-01-01", list)?.centimes).toBe(600_000_000n);
    expect(thresholdOn("2026-11-15")?.centimes).toBe(500_000_000n); // the configured one
  });
});
