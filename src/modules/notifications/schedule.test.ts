import { describe, expect, it } from "vitest";
import { farmDayOf, farmMinutesOf } from "@/lib/kernel/farm-day";
import { DEFAULT_QUIET_HOURS as night, deliverAfter } from "./schedule";

const at = (iso: string) => new Date(iso);
const farmTime = (d: Date) => `${farmDayOf(d)} ${String(Math.floor(farmMinutesOf(d) / 60)).padStart(2, "0")}:${String(farmMinutesOf(d) % 60).padStart(2, "0")}`;

// Morocco is UTC+1, except UTC+0 around Ramadan (2026: Feb 15 → Mar 22).
describe("deliverAfter (SPEC N2)", () => {
  it("sends now outside the quiet hours", () => {
    const noon = at("2026-04-01T11:00:00Z"); // 12:00 on the farm
    expect(deliverAfter(noon, night, false)).toEqual(noon);
    expect(deliverAfter(at("2026-04-01T20:59:00Z"), night, false)).toEqual(at("2026-04-01T20:59:00Z")); // 21:59
  });

  it("holds a normal notification until the end of the quiet hours, across midnight", () => {
    expect(deliverAfter(at("2026-04-01T22:30:00Z"), night, false)).toEqual(at("2026-04-02T05:00:00Z")); // 23:30 → 06:00 next day
    expect(deliverAfter(at("2026-04-02T02:00:00Z"), night, false)).toEqual(at("2026-04-02T05:00:00Z")); // 03:00 → 06:00 same day
    expect(deliverAfter(at("2026-04-01T21:00:00Z"), night, false)).toEqual(at("2026-04-02T05:00:00Z")); // 22:00 sharp is quiet
    expect(deliverAfter(at("2026-04-02T05:00:00Z"), night, false)).toEqual(at("2026-04-02T05:00:00Z")); // 06:00 sharp is not
  });

  it("sends urgent notifications immediately, even at night", () => {
    const night23 = at("2026-04-01T22:30:00Z");
    expect(deliverAfter(night23, night, true)).toEqual(night23);
  });

  it("follows the farm clock during Ramadan (UTC+0) and across the change back", () => {
    expect(deliverAfter(at("2026-03-01T23:30:00Z"), night, false)).toEqual(at("2026-03-02T06:00:00Z")); // UTC+0
    const lastRamadanNight = deliverAfter(at("2026-03-21T23:30:00Z"), night, false);
    expect(farmTime(lastRamadanNight)).toBe("2026-03-22 06:00"); // whichever offset that morning has
  });

  it("handles a daytime window and no window at all", () => {
    const siesta = { start: "13:00", end: "15:00" };
    expect(deliverAfter(at("2026-04-01T12:30:00Z"), siesta, false)).toEqual(at("2026-04-01T14:00:00Z")); // 13:30 → 15:00
    expect(deliverAfter(at("2026-04-01T15:00:00Z"), siesta, false)).toEqual(at("2026-04-01T15:00:00Z")); // 16:00
    const none = { start: "00:00", end: "00:00" };
    expect(deliverAfter(at("2026-04-01T22:30:00Z"), none, false)).toEqual(at("2026-04-01T22:30:00Z"));
  });
});
