import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { Batch, type Placement } from "./batch";
import { correctPlacement, houseFreeFrom, recordedOf, type Recorded } from "./correction";

const day = (d: string) => d as FarmDay;
const placement: Placement = {
  id: "b1",
  farmId: "f1",
  houseId: "h1",
  species: "broiler",
  strainId: "ross-308",
  placedOn: day("2026-10-14"),
  chicksPlaced: 12_000,
  deadOnArrival: 36,
  hatchery: "Couvoir Atlas",
  deliveryNote: "BL-0412",
  chickUnitPriceCentimes: 450n,
  dayOldWeightGrams: 42,
};
const today = day("2026-10-20");
const open = Batch.rehydrate(placement, "open");
const none: Recorded = { firstDay: null, birdsOut: 0, houseFreeFrom: null };

describe("correcting a placement (SPEC B1)", () => {
  it("changes the typed figures, checked as a new placement", () => {
    const r = correctPlacement(open, { chicksPlaced: 11_000, freeChicks: 220, chickUnitPriceCentimes: 500n, hatchery: "Couvoir Souss", placedOn: day("2026-10-12") }, none, today);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.placement).toMatchObject({ id: "b1", chicksPlaced: 11_000, freeChicks: 220, chickUnitPriceCentimes: 500n, hatchery: "Couvoir Souss", placedOn: "2026-10-12", strainId: "ross-308" });
    expect(r.value.status).toBe("open");
    expect(correctPlacement(open, { deadOnArrival: 12_000 }, none, today)).toEqual({ ok: false, error: "DEAD_ON_ARRIVAL_TOO_HIGH" });
    expect(correctPlacement(open, { chicksPlaced: 0 }, none, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(correctPlacement(open, { placedOn: day("2026-10-22") }, none, today)).toEqual({ ok: false, error: "PLACEMENT_IN_FUTURE" });
  });

  it("refuses a closed batch and one made by a transfer to lay", () => {
    expect(correctPlacement(Batch.rehydrate(placement, "closed"), { hatchery: "X" }, none, today)).toEqual({ ok: false, error: "BATCH_CLOSED" });
    expect(correctPlacement(Batch.rehydrate({ ...placement, fromBatchId: "p1" }, "open"), { hatchery: "X" }, none, today)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("is bounded by what the batch recorded", () => {
    const recorded: Recorded = { firstDay: day("2026-10-15"), birdsOut: 500, houseFreeFrom: day("2026-09-30") };
    expect(correctPlacement(open, { houseId: "h2" }, recorded, today)).toEqual({ ok: false, error: "BATCH_HAS_DATA" });
    expect(correctPlacement(open, { houseId: "h1" }, recorded, today).ok).toBe(true); // the same house is no change
    expect(correctPlacement(open, { placedOn: day("2026-10-15") }, recorded, today).ok).toBe(true); // on the first day of data
    expect(correctPlacement(open, { placedOn: day("2026-10-16") }, recorded, today)).toEqual({ ok: false, error: "PLACEMENT_AFTER_DATA" });
    expect(correctPlacement(open, { placedOn: day("2026-09-30") }, recorded, today).ok).toBe(true); // the day the house was emptied
    expect(correctPlacement(open, { placedOn: day("2026-09-29") }, recorded, today)).toEqual({ ok: false, error: "PLACEMENT_OVERLAPS_PREVIOUS" });
    expect(correctPlacement(open, { chicksPlaced: 536 }, recorded, today).ok).toBe(true); // 536 − 36 = the 500 gone
    expect(correctPlacement(open, { chicksPlaced: 535 }, recorded, today)).toEqual({ ok: false, error: "FEWER_BIRDS_THAN_RECORDED" });
    expect(correctPlacement(open, { houseId: "h2" }, none, today).ok).toBe(true); // no data yet: the house may change
  });

  it("reads the bounds from the batch's records and its houses' closings", () => {
    expect(recordedOf([{ day: "2026-10-16", dead: 3, culled: 1 }, { day: "2026-10-15", dead: 2, culled: 0 }], [{ day: "2026-10-17" }], [{ day: "2026-10-14", birds: 10 }])).toEqual({ firstDay: "2026-10-14", birdsOut: 16 });
    expect(recordedOf([], [], [])).toEqual({ firstDay: null, birdsOut: 0 });
    const closed = [
      { id: "old", houseId: "h1", closedOn: "2026-09-30" },
      { id: "older", houseId: "h1", closedOn: "2026-08-01" },
      { id: "pair", houseId: "h1", closedOn: "2026-10-18" }, // closed after this batch arrived: shared the house
      { id: "h2a", houseId: "h2", closedOn: "2026-10-18" },
      { id: "open", houseId: "h2", closedOn: null },
    ];
    expect(houseFreeFrom(placement, "h1", closed)).toBe("2026-09-30");
    expect(houseFreeFrom(placement, "h2", closed)).toBe("2026-10-18");
    expect(houseFreeFrom(placement, "h3", closed)).toBeNull();
  });
});
