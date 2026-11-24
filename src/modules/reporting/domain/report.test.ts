import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { BatchDto, DailyEntryDto, SoldBirdsDto, WeighingDto } from "@/modules/flock/shared";
import { buildBatchReport, type ResultRow } from "./report";

// SPEC-m2-compliance RP3, §8: the closing report of a batch and its comparison with the farm's previous batches.
const batch = (id: string, placedOn: string, over: Partial<BatchDto> = {}): BatchDto => ({
  id, farmId: "farm", houseId: "h1", species: "broiler", strainId: "ross-308", placedOn, chicksPlaced: 1000, deadOnArrival: 0,
  hatchery: "H", deliveryNote: "BL", dayOldWeightGrams: 40, status: "closed", ...over,
});
const day = (batchId: string, d: string, dead: number, feedKg: number): DailyEntryDto => ({ id: `${batchId}${d}`, batchId, day: d, dead, deathCause: null, culled: 0, feed: { stockItemId: "f", grams: feedKg * 1000 }, waterMl: null, note: null });
const sold = (batchId: string, d: string, birds: number, kg: number): SoldBirdsDto => ({ id: `s${batchId}`, batchId, day: d, birds, liveWeightGrams: kg * 1000 });
const result = (id: string, sales: number, cost: number, kg: number): ResultRow => ({
  id, salesCentimes: String(sales * 100), costCentimes: String(cost * 100), marginCentimes: String((sales - cost) * 100), soldGrams: kg * 1000,
  costPerKgCentimes: String(Math.round((cost * 100 * 1000) / (kg * 1000))), marginPerKgCentimes: String(Math.round(((sales - cost) * 100 * 1000) / (kg * 1000))), marginPermille: String(Math.floor(((sales - cost) * 1000) / sales)),
});

const b13 = batch("b13", "2026-09-21", { closedOn: "2026-11-03" });
const b11 = batch("b11", "2026-07-01", { closedOn: "2026-08-12" });
const other = batch("x", "2026-08-01", { farmId: "other-farm", closedOn: "2026-09-10" });
const input = {
  batch: b13,
  today: "2026-11-16" as FarmDay,
  batches: [b13, b11, other],
  entries: [day("b13", "2026-10-01", 20, 2000), day("b13", "2026-11-01", 20, 2000), day("b11", "2026-07-10", 60, 4200)],
  weighings: [],
  sold: [sold("b13", "2026-11-03", 960, 2370), sold("b11", "2026-08-12", 940, 2200)],
  vaccinations: [
    { id: "v1", batchId: "b13", dayOfAge: 14, dueOn: "2026-10-05", productId: "g", method: "drinkingWater" as const, done: { on: "2026-10-05", stockItemId: "s", doses: 1000, method: "drinkingWater" as const, byUserId: "u" } },
    { id: "v2", batchId: "b13", dayOfAge: 18, dueOn: "2026-10-09", productId: "n", method: "drinkingWater" as const, done: null },
  ],
  treatments: [{ id: "t", batchId: "b13", stockItemId: "s", quantity: 1, dose: "d", startOn: "2026-10-22", endOn: "2026-10-26", reason: "r", prescriber: "p", withdrawalDays: 5, withdrawalEndsOn: "2026-10-31", byUserId: "u" }],
  results: [result("b13", 31501, 27080, 2370), result("b11", 28000, 26000, 2200)],
  standardAt: null,
};

describe("buildBatchReport", () => {
  it("final figures of a closed batch: mortality, feed conversion on the kg sold, health summary", () => {
    const r = buildBatchReport(input);
    expect(r.kpis).toMatchObject({ placed: 1000, freeChicks: 0, dead: 40, sold: 960, soldGrams: 2_370_000, feedGrams: 4_000_000, mortalityPercent: 4, fcr: 4000 / 2370 });
    expect(r.health).toEqual({ vaccinesDone: 1, vaccinesPlanned: 2, treatments: 1, lastWithdrawalEnd: "2026-10-31" });
  });

  it("a closed batch's FCR and EPEF are both its final ones (feed ÷ kg sold), not the last weighing's estimate", () => {
    const weighings: WeighingDto[] = [{ id: "w", batchId: "b13", day: "2026-10-26", count: 100, totalGrams: 200_000, weightsGrams: [] }]; // day 35, 2 kg
    const k = buildBatchReport({ ...input, weighings }).kpis;
    expect(k.fcr).toBeCloseTo(4000 / 2370, 9);
    // Livability 96 % × 2,46875 kg sold per bird / (43 days × 4 000 / 2 370) × 100 = 326,56
    expect(k.epef).toBeCloseTo(326.5639, 3);
    expect(k.weighed?.epef).not.toBeCloseTo(k.epef!, 0); // the estimate at day 35 is another figure
  });

  it("takes the money from finance's own result for the batch, untouched", () => {
    expect(buildBatchReport(input).money).toEqual(input.results[0]);
    expect(buildBatchReport({ ...input, results: null }).money).toBeNull(); // no money on the page without the right
  });

  it("compares with the same farm's earlier closed batches, newest first", () => {
    expect(buildBatchReport(input).comparison).toEqual([
      { id: "b13", placedOn: "2026-09-21", mortalityPercent: 4, fcr: 4000 / 2370, costPerKgCentimes: "1143", marginPerKgCentimes: "187" },
      { id: "b11", placedOn: "2026-07-01", mortalityPercent: 6, fcr: 4200 / 2200, costPerKgCentimes: "1182", marginPerKgCentimes: "91" },
    ]);
  });

  it("counts free chicks in the birds started and the age at placement, as the batch screen (SPEC-m3 B7, B10)", () => {
    const b = { ...b13, freeChicks: 20, deadOnArrival: 20, ageAtPlacementDays: 10 }; // 1 000 + 20 free − 20 on arrival
    const k = buildBatchReport({ ...input, batch: b, batches: [b, b11] }).kpis;
    expect(k.mortalityPercent).toBe(4); // 40 of 1 000, not of 980
    expect(k).toMatchObject({ placed: 1020, freeChicks: 20 }); // placed: billed + free
    expect(k.ageDays).toBe(53); // 43 days in the house + 10 at placement
  });

  it("compares only with batches of the same production type (as D2)", () => {
    const turkeys = batch("t", "2026-06-01", { species: "turkey", closedOn: "2026-08-30" });
    expect(buildBatchReport({ ...input, batches: [...input.batches, turkeys] }).comparison.map((c) => c.id)).toEqual(["b13", "b11"]);
  });

  it("the latest weighing against the strain's standard at its age, nothing without a curve (OQ5)", () => {
    const open = batch("b14", "2026-10-01", { status: "open" });
    const weighings: WeighingDto[] = [{ id: "w", batchId: "b14", day: "2026-11-05", count: 100, totalGrams: 200_000, weightsGrams: [] }]; // day 35, 2 kg
    const curve = new Map([[35, 2500]]); // fixture: grams at a day of age
    const standardAt = (age: number) => (curve.has(age) ? { bodyWeightGrams: curve.get(age)! } : null);
    const of = (over: Partial<Parameters<typeof buildBatchReport>[0]>) => buildBatchReport({ ...input, batch: open, batches: [open], weighings, ...over }).standard;
    expect(of({ standardAt })).toEqual({ bodyWeightGrams: 2500, gapPercent: -20 });
    expect(of({ standardAt: null })).toBeNull(); // no curve loaded
    expect(of({ standardAt, weighings: [] })).toBeNull(); // not weighed yet
  });
});
