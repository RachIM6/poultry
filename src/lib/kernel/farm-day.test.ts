import { describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/kernel/clock";
import { latestRecordableDay } from "@/lib/kernel/farm-day";

describe("latestRecordableDay", () => {
  it("is the farm day after the server's, so a phone running ahead past midnight is not refused", () => {
    expect(latestRecordableDay(fixedClock("2026-11-24T12:00:00Z"))).toBe("2026-11-25");
    expect(latestRecordableDay(fixedClock("2026-12-31T12:00:00Z"))).toBe("2027-01-01");
  });
});
