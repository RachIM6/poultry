import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { houseFigure } from "./house-figures";
import { batchKpis } from "./kpi";

// 1 000 birds placed on 1 Oct; 10 dead and 100 kg of feed on 3 Oct; a group of 10 birds weighed 10 kg on 4 Oct.
const base = { placedOn: "2026-10-01" as FarmDay, birdsStarted: 1000, dayOldWeightGrams: null };
const entries = [{ day: "2026-10-03", dead: 10, culled: 0, feed: { grams: 100_000 } }];
const group = { id: "w1", day: "2026-10-04", count: 10, totalGrams: 10_000, weightsGrams: [] as number[] };
const today = "2026-10-05" as FarmDay;

describe("houseFigure (SPEC-m3 D1, B9)", () => {
  it("broilers and turkeys: batchKpis' cumulative FCR at the latest weighing", () => {
    // 990 birds × 1 000 g = 990 kg live; 100 kg of feed / 990 kg = 0.1010.
    for (const species of ["broiler", "turkey"] as const) {
      const f = houseFigure({ ...base, species }, entries, [group], today);
      expect(f).toEqual({ kind: "fcr", value: batchKpis(base, entries, [group], today).weighed!.fcr });
      expect(f!.value).toBeCloseTo(100 / 990, 8);
    }
  });

  it("broilers: null before a weighing or before any feed", () => {
    expect(houseFigure({ ...base, species: "broiler" }, entries, [], today)).toBeNull();
    expect(houseFigure({ ...base, species: "broiler" }, [], [group], today)).toBeNull();
  });

  it("pullets: the uniformity of the latest weighing", () => {
    // Mean 1 000 g; 880 g is outside 900–1 100 g: 5 of 6 → 83.3 %. The older weighing (all within) is ignored.
    const old = { id: "w1", day: "2026-10-02", count: 2, totalGrams: 2000, weightsGrams: [1000, 1000] };
    const last = { id: "w2", day: "2026-10-04", count: 6, totalGrams: 6000, weightsGrams: [950, 1000, 1050, 1100, 880, 1020] };
    expect(houseFigure({ ...base, species: "pullet" }, entries, [last, old], today)).toEqual({ kind: "uniformity", value: 83.3 });
    // Same day: the later id (UUIDv7) wins, as in batchKpis.
    expect(houseFigure({ ...base, species: "pullet" }, entries, [{ ...old, day: last.day, id: "w3" }, last], today)).toEqual({ kind: "uniformity", value: 100 });
  });

  it("pullets: null when the latest weighing was a group one", () => {
    const old = { id: "w0", day: "2026-10-02", count: 2, totalGrams: 2000, weightsGrams: [1000, 1000] };
    expect(houseFigure({ ...base, species: "pullet" }, entries, [old, group], today)).toBeNull();
  });

  it("other types show no figure", () => {
    const w = [{ ...group, weightsGrams: [1000, 1000] }];
    for (const species of ["layer", "beldi"] as const) expect(houseFigure({ ...base, species }, entries, w, today)).toBeNull();
  });
});
