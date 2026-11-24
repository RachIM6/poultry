import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { EMPTY_COUNTS, checkCollection, downgradedIn, eggsIn } from "./collection";

const day = (d: string) => d as FarmDay;
const layers = { species: "layer", status: "open", placedOn: day("2026-06-03") };
// P-EggCollect's example collection.
const counts = { normal: 1642, cracked: 18, dirty: 31, doubleYolk: 6, floor: 12, broken: 4 };

describe("egg collection (SPEC-m3 E1)", () => {
  it("totals the eggs and the downgraded ones", () => {
    expect(eggsIn(counts)).toBe(1713);
    expect(downgradedIn(counts)).toBe(65); // cracked + dirty + floor + broken
  });

  it("accepts a layer batch's collection between its placement and today, with an optional sample", () => {
    const today = day("2026-11-16");
    expect(checkCollection(layers, today, counts, null, today).ok).toBe(true);
    expect(checkCollection(layers, today, counts, { count: 30, grams: 1854 }, today).ok).toBe(true);
    expect(checkCollection({ ...layers, species: "pullet" }, today, counts, null, today)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(checkCollection({ ...layers, status: "closed" }, today, counts, null, today)).toEqual({ ok: false, error: "BATCH_CLOSED" });
    expect(checkCollection(layers, day("2026-06-02"), counts, null, today)).toEqual({ ok: false, error: "DAY_BEFORE_PLACEMENT" });
    expect(checkCollection(layers, day("2026-11-17"), counts, null, today)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(checkCollection(layers, today, EMPTY_COUNTS, null, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(checkCollection(layers, today, { ...counts, dirty: -1 }, null, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(checkCollection(layers, today, { ...counts, normal: 1.5 }, null, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(checkCollection(layers, today, counts, { count: 1714, grams: 100_000 }, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
  });
});
