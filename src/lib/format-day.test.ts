import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { formatDayShort, formatMomentShort } from "@/lib/format-day";
import { formatPhone } from "@/lib/format-phone";
import { addMonths, monthsBetween } from "@/components/month-select";

const today = "2026-11-26" as FarmDay;

describe("formatDayShort", () => {
  it("drops this year, keeps another", () => {
    expect(formatDayShort("2026-08-18", "fr", today)).toBe("18 août");
    expect(formatDayShort("2025-08-18", "fr", today)).toBe("18 août 2025");
  });
});

describe("formatMomentShort", () => {
  it("reads in farm time, the year only when not this year's", () => {
    // Noon UTC: the same day in Casablanca whatever its offset (+0 or +1)
    expect(formatMomentShort("2026-11-26T12:25:00Z", "fr", today)).toMatch(/^26 novembre à 1[23]:25$/);
    expect(formatMomentShort("2025-06-01T12:25:00Z", "fr", today)).toMatch(/^1 juin 2025 à 1[23]:25$/);
  });
});

describe("formatPhone", () => {
  it("writes a Moroccan number in pairs from its 0, leaves others", () => {
    expect(formatPhone("+212600000182")).toBe("06 00 00 01 82");
    expect(formatPhone("+33612345678")).toBe("+33612345678");
    expect(formatPhone("owner@example.com")).toBe("owner@example.com");
  });
});

describe("months", () => {
  it("steps across a year end", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsBetween("2026-11", "2026-10")).toEqual([]);
  });
});
