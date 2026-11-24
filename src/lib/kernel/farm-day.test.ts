import { describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/kernel/clock";
import { daysBetween, latestRecordableDay, type FarmDay } from "@/lib/kernel/farm-day";

describe("latestRecordableDay", () => {
  it("is the farm day after the server's, so a phone running ahead past midnight is not refused", () => {
    expect(latestRecordableDay(fixedClock("2026-11-24T12:00:00Z"))).toBe("2026-11-25");
    expect(latestRecordableDay(fixedClock("2026-12-31T12:00:00Z"))).toBe("2027-01-01");
  });
});

describe("daysBetween", () => {
  const d = (s: string) => s as FarmDay;
  it("counts whole calendar days, negative when `to` is earlier", () => {
    expect(daysBetween(d("2026-11-01"), d("2026-11-01"))).toBe(0);
    expect(daysBetween(d("2026-11-01"), d("2026-11-30"))).toBe(29);
    expect(daysBetween(d("2026-12-31"), d("2027-01-01"))).toBe(1);
    expect(daysBetween(d("2028-02-28"), d("2028-03-01"))).toBe(2); // leap year
    expect(daysBetween(d("2026-11-30"), d("2026-11-01"))).toBe(-29);
  });

  it("ignores Morocco's Ramadan offset change: calendar days, not hours", () => {
    expect(daysBetween(d("2026-02-01"), d("2026-04-01"))).toBe(59);
  });
});
