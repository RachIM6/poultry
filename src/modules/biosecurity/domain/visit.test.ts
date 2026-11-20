import { describe, expect, it } from "vitest";
import { visitZone } from "./visit";

// SPEC-m2-compliance BS2, §8 fixture.
describe("visitZone", () => {
  it("a visitor from another poultry farm recently is kept to the dirty zone", () => {
    expect(visitZone({ recentFarm: true, zone: "dirty" })).toEqual({ ok: true, value: "dirty" });
    expect(visitZone({ recentFarm: true, zone: "clean" })).toEqual({ ok: false, error: "VISIT_DIRTY_ZONE_ONLY" });
  });
  it("otherwise the chosen zone stands", () => {
    expect(visitZone({ recentFarm: false, zone: "clean" })).toEqual({ ok: true, value: "clean" });
    expect(visitZone({ recentFarm: false, zone: "dirty" })).toEqual({ ok: true, value: "dirty" });
  });
});
