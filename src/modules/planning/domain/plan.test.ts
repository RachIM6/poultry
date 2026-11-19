import { describe, expect, it } from "vitest";
import { downtimeOn, houseTimeline, saleDay, type DowntimeRule, type Slot } from "./plan";

// SPEC-m5 PL2, PL5. Made-up dates and downtime: the minimum is the owner's (NQ4), never ours.
const slot = (id: string, placeOn: string, sale: string | null, kind: Slot["kind"] = "plan"): Slot => ({ kind, id, placeOn, saleDay: sale });

describe("the planner (PL2)", () => {
  it("sale day is the placement day plus the planned sale age, unknown without one", () => {
    expect(saleDay("2026-12-01", 35)).toBe("2027-01-05");
    expect(saleDay("2026-12-01", null)).toBeNull();
  });

  it("orders a house by placement, with the gap after the previous sale day and the overlaps", () => {
    const lines = houseTimeline([slot("p2", "2027-01-20", null), slot("b", "2026-11-01", "2026-12-06", "batch"), slot("p1", "2026-12-01", "2027-01-05")], null);
    expect(lines.map((l) => [l.id, l.gapDays, l.overlaps, l.shortDowntime])).toEqual([
      ["b", null, false, false],
      ["p1", -5, true, false], // placed 5 days before the open batch's sale
      ["p2", 15, false, false],
    ]);
  });

  it("claims nothing after a slot without a sale day", () => {
    const lines = houseTimeline([slot("b", "2026-11-01", null, "batch"), slot("p1", "2026-11-10", "2026-12-15")], 14);
    expect(lines[1]).toMatchObject({ gapDays: null, overlaps: false, shortDowntime: false });
  });

  it("warns about a short downtime only when the owner entered a minimum", () => {
    const slots = [slot("b", "2026-11-01", "2026-12-06", "batch"), slot("p1", "2026-12-16", null)];
    expect(houseTimeline(slots, null)[1]).toMatchObject({ gapDays: 10, shortDowntime: false });
    expect(houseTimeline(slots, 14)[1]).toMatchObject({ gapDays: 10, shortDowntime: true });
    expect(houseTimeline(slots, 10)[1]).toMatchObject({ shortDowntime: false });
  });
});

describe("the farm's minimum downtime (PL5)", () => {
  const rule = (id: string, farmId: string, validFrom: string, minDays: number): DowntimeRule => ({ id, farmId, validFrom, minDays, source: "Test" });
  it("is the farm's latest version in force on the day, or none", () => {
    const rules = [rule("r1", "f", "2026-01-01", 10), rule("r2", "f", "2026-06-01", 14), rule("r3", "g", "2026-01-01", 21)];
    expect(downtimeOn(rules, "f", "2026-07-01")).toBe(14);
    expect(downtimeOn(rules, "f", "2026-03-01")).toBe(10);
    expect(downtimeOn(rules, "f", "2025-12-31")).toBeNull();
    expect(downtimeOn([], "f", "2026-07-01")).toBeNull();
  });
});
