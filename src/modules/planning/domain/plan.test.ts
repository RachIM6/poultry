import { describe, expect, it } from "vitest";
import { batchDowntime, checkDowntimeRule, downtimeByHouse, downtimeOn, houseCycles, houseTimeline, OFFICIAL_DOWNTIME, placementDowntime, saleDay, type DowntimeRule, type HouseCycle, type Slot } from "./plan";

// SPEC-m5 PL2, PL5, SPEC-m2-compliance BS5 (CQ3, NQ4). Made-up dates; the 20 days are arrêté n° 2127-05, art. 4.
const slot = (id: string, placeOn: string, sale: string | null, kind: Slot["kind"] = "plan"): Slot => ({ kind, id, placeOn, saleDay: sale });

describe("the planner (PL2)", () => {
  it("sale day is the placement day plus the planned sale age, unknown without one", () => {
    expect(saleDay("2026-12-01", 35)).toBe("2027-01-05");
    expect(saleDay("2026-12-01", null)).toBeNull();
  });

  it("orders a house by placement, with the gap after the previous sale day and the overlaps", () => {
    const lines = houseTimeline([slot("p2", "2027-01-20", null), slot("b", "2026-11-01", "2026-12-06", "batch"), slot("p1", "2026-12-01", "2027-01-05")], 10);
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

  it("warns about a gap shorter than the minimum in force", () => {
    const slots = [slot("b", "2026-11-01", "2026-12-06", "batch"), slot("p1", "2026-12-16", null)];
    expect(houseTimeline(slots, 20)[1]).toMatchObject({ gapDays: 10, shortDowntime: true });
    expect(houseTimeline(slots, 10)[1]).toMatchObject({ gapDays: 10, shortDowntime: false });
  });
});

describe("the farm's minimum downtime (PL5, CQ3)", () => {
  const rule = (id: string, farmId: string, validFrom: string, minDays: number): DowntimeRule => ({ id, farmId, validFrom, minDays, source: "Test" });
  it("is the farm's latest rule in force on the day, else the official 20 days", () => {
    const rules = [rule("r1", "f", "2026-01-01", 25), rule("r2", "f", "2026-06-01", 30), rule("r3", "g", "2026-01-01", 21)];
    expect(downtimeOn(rules, "f", "2026-07-01")).toMatchObject({ minDays: 30, source: "Test" });
    expect(downtimeOn(rules, "f", "2026-03-01")).toMatchObject({ minDays: 25 });
    expect(downtimeOn(rules, "f", "2025-12-31")).toEqual({ minDays: 20, source: "Arrêté n° 2127-05 du 15 décembre 2005, art. 4" });
    expect(downtimeOn([], "f", "2026-07-01")).toBe(OFFICIAL_DOWNTIME);
  });

  it("never goes below the official figure: a lower rule is refused, an older one gives way", () => {
    expect(checkDowntimeRule({ minDays: 19 })).toEqual({ ok: false, error: "DOWNTIME_BELOW_OFFICIAL" });
    expect(checkDowntimeRule({ minDays: 20 }).ok).toBe(true);
    expect(checkDowntimeRule({ minDays: 28 }).ok).toBe(true);
    expect(downtimeOn([rule("old", "f", "2026-01-01", 14)], "f", "2026-07-01").minDays).toBe(20); // entered before the floor
  });
});

describe("the placement warning (BS5, art. 4)", () => {
  const house = (houseId: string, endedOn: string | null, openSince: string | null = null): HouseCycle => ({ houseId, endedOn, openSince });

  it("counts from the disinfection day when known, else from the last batch's removal", () => {
    const batches = [
      { id: "x", houseId: "h1", placedOn: "2026-09-01", status: "closed", closedOn: "2026-10-10" },
      { id: "y", houseId: "h2", placedOn: "2026-09-02", status: "closed", closedOn: "2026-10-12" },
      { id: "old", houseId: "h2", placedOn: "2026-06-01", status: "closed", closedOn: "2026-07-10" },
      { id: "z", houseId: "h3", placedOn: "2026-11-01", status: "open" },
    ];
    expect(houseCycles(["h1", "h2", "h3", "h4"], batches, new Map([["x", "2026-10-15"], ["old", "2026-07-12"]]))).toEqual([
      house("h1", "2026-10-15"), // disinfected
      house("h2", "2026-10-12"), // not disinfected yet: its removal
      house("h3", null, "2026-11-01"),
      house("h4", null),
    ]);
  });

  it("farm-wide (broilers, other meat birds): from the farm's last end, whichever house", () => {
    const farm = [house("h1", "2026-10-15"), house("h2", "2026-10-20")];
    expect(placementDowntime(20, false, farm, "h1", "2026-11-05")).toEqual({ kind: "short", elapsedDays: 16, minDays: 20 }); // h2 ended later
    expect(placementDowntime(20, false, farm, "h1", "2026-11-09")).toBeNull(); // 20 days
    expect(placementDowntime(20, false, [], "h1", "2026-11-09")).toBeNull(); // a first cycle: nothing to count
  });

  it("farm-wide: another house still holding a batch of the previous cycle warns; one of the new cycle doesn't", () => {
    expect(placementDowntime(20, false, [house("h1", "2026-10-15"), house("h2", null, "2026-09-02")], "h1", "2026-11-20")).toEqual({ kind: "occupied", houseId: "h2" });
    expect(placementDowntime(20, false, [house("h1", "2026-10-15"), house("h2", null, "2026-11-10")], "h1", "2026-11-20")).toBeNull(); // placed after the downtime
  });

  it("judges a batch already placed from the farm as it stood that day (the inspection checklist)", () => {
    const b13 = { id: "b13", farmId: "f", houseId: "h1", species: "broiler", placedOn: "2026-09-21", status: "closed", closedOn: "2026-11-03" };
    const b14 = { id: "b14", farmId: "f", houseId: "h1", species: "broiler", placedOn: "2026-11-20", status: "open" };
    const later = { id: "b15", farmId: "f", houseId: "h2", species: "broiler", placedOn: "2026-12-30", status: "open" }; // not there yet on 20 Nov
    expect(batchDowntime([], b14, [b13, b14, later], new Map())).toEqual({ kind: "short", elapsedDays: 17, minDays: 20 }); // from the closing
    expect(batchDowntime([], b14, [b13, b14, later], new Map([["b13", "2026-11-05"]]))).toEqual({ kind: "short", elapsedDays: 15, minDays: 20 }); // from the disinfection
    expect(batchDowntime([], { ...b14, placedOn: "2026-11-23" }, [b13, later], new Map())).toBeNull(); // 20 days
    // b13 was still open when b12 (another house) was placed after h3 ended: not judged against its own later closing
    const h3 = { id: "b11", farmId: "f", houseId: "h3", species: "broiler", placedOn: "2026-07-01", status: "closed", closedOn: "2026-08-10" };
    expect(batchDowntime([], { ...b14, id: "b12", houseId: "h2", placedOn: "2026-09-15" }, [h3, b13], new Map())).toBeNull(); // 36 days after h3, b13 not placed yet
    expect(batchDowntime([], { ...b14, id: "b12", houseId: "h2", placedOn: "2026-10-01" }, [h3, { ...b13, placedOn: "2026-08-01" }], new Map())).toEqual({ kind: "occupied", houseId: "h1" });
  });

  it("house by house (table-egg layers): only the house's own end counts, other houses' batches don't", () => {
    expect(downtimeByHouse("layer")).toBe(true);
    expect(["broiler", "turkey", "pullet", "beldi", "duck", "quail"].some(downtimeByHouse)).toBe(false);
    const farm = [house("h1", "2026-10-01"), house("h2", "2026-10-20"), house("h3", null, "2026-01-05")];
    expect(placementDowntime(20, true, farm, "h1", "2026-10-25")).toBeNull(); // 24 days for h1
    expect(placementDowntime(20, true, farm, "h2", "2026-10-25")).toEqual({ kind: "short", elapsedDays: 5, minDays: 20 });
  });
});
