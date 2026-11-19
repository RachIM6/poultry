import { describe, expect, it } from "vitest";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { formatDay, formatKg, formatMoney } from "@/lib/format";

const NNBSP = " "; // narrow no-break space: French thousands separator
const NBSP = " "; // keeps the unit on the same line as the number

describe("formatMoney", () => {
  it("formats centimes as dirhams with Western digits", () => {
    expect(formatMoney(123450n)).toBe(`1${NNBSP}234,50${NBSP}DH`);
    expect(formatMoney(5n)).toBe(`0,05${NBSP}DH`);
    expect(formatMoney(-123450n)).toBe(`-1${NNBSP}234,50${NBSP}DH`);
  });

  it("stays exact beyond Number precision", () => {
    expect(formatMoney(900719925474099199n)).toBe(
      `9${NNBSP}007${NNBSP}199${NNBSP}254${NNBSP}740${NNBSP}991,99${NBSP}DH`,
    );
  });
});

describe("formatKg", () => {
  it("formats grams as kilograms, up to 3 decimals", () => {
    expect(formatKg(1_234_500)).toBe(`1${NNBSP}234,5${NBSP}kg`);
    expect(formatKg(42)).toBe(`0,042${NBSP}kg`);
  });
});

describe("formatDay", () => {
  it("formats a farm day with Western digits in both locales", () => {
    const day = "2026-10-27" as FarmDay;
    expect(formatDay(day, "fr")).toBe("27 octobre 2026");
    expect(formatDay(day, "ar")).toMatch(/^27 \S+ 2026$/);
    expect(formatDay(day, "ar")).not.toMatch(/[٠-٩]/); // no Arabic-Indic digits
  });
});

describe("farmDayOf", () => {
  // Morocco is UTC+1, except UTC+0 around Ramadan (2026: Feb 15 → Mar 22).
  it("uses UTC+1 outside Ramadan", () => {
    expect(farmDayOf(new Date("2026-04-01T23:30:00Z"))).toBe("2026-04-02");
    expect(farmDayOf(new Date("2026-02-14T23:30:00Z"))).toBe("2026-02-15");
  });

  it("uses UTC+0 during Ramadan", () => {
    expect(farmDayOf(new Date("2026-03-01T23:30:00Z"))).toBe("2026-03-01");
  });
});
