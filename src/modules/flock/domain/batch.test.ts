import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { Batch, type Placement } from "./batch";

const day = (d: string) => d as FarmDay;
const placement: Placement = {
  id: "b1",
  farmId: "f1",
  houseId: "h1",
  strainId: "ross-308",
  placedOn: day("2026-10-14"),
  chicksPlaced: 12_000,
  deadOnArrival: 36,
  hatchery: "Couvoir Atlas",
  deliveryNote: "BL-2026-0412",
  chickUnitPriceCentimes: 450n,
  dayOldWeightGrams: 42,
};

describe("Batch placement (SPEC B1)", () => {
  it("counts age in farm days from the placement day, which is day 0", () => {
    const batch = Batch.place(placement, day("2026-11-21"));
    if (!batch.ok) throw new Error(batch.error);
    expect(batch.value.ageOn(day("2026-10-14"))).toBe(0);
    expect(batch.value.ageOn(day("2026-10-15"))).toBe(1);
    expect(batch.value.ageOn(day("2026-11-21"))).toBe(38);
    expect(batch.value.ageOn(day("2027-01-02"))).toBe(80); // across a month and a year end
  });

  it("is open, starts with the chicks placed minus those dead on arrival, and can only be closed", () => {
    const batch = Batch.place(placement, day("2026-10-14"));
    if (!batch.ok) throw new Error(batch.error);
    expect(batch.value.status).toBe("open");
    expect(batch.value.birdsStarted).toBe(11_964);
    expect([batch.value.canBecome("closed"), Batch.rehydrate(placement, "closed").canBecome("open")]).toEqual([true, false]);
  });

  it("refuses impossible placements", () => {
    const today = day("2026-10-20");
    expect(Batch.place({ ...placement, chicksPlaced: 0 }, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(Batch.place({ ...placement, deadOnArrival: -1 }, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(Batch.place({ ...placement, deadOnArrival: 12_000 }, today)).toEqual({ ok: false, error: "DEAD_ON_ARRIVAL_TOO_HIGH" });
    expect(Batch.place({ ...placement, dayOldWeightGrams: 0 }, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(Batch.place({ ...placement, placedOn: day("2026-10-21") }, today)).toEqual({ ok: false, error: "PLACEMENT_IN_FUTURE" });
    expect(Batch.place({ ...placement, dayOldWeightGrams: null, chickUnitPriceCentimes: 0n }, today).ok).toBe(true);
  });
});
