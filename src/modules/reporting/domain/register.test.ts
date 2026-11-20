import { describe, expect, it } from "vitest";
import { buildRegister, type RegisterInput } from "./register";

// SPEC-m2-compliance RP1, §8 fixtures: the canvas batch B-2026-13 (Ross 308, 10 000 chicks on 21 Sept 2026).
const batchId = "b-13";
const input = (over: Partial<RegisterInput> = {}): RegisterInput => ({
  farm: { name: "Ferme El Kheir", commune: "Ouled Said", province: "Settat", region: "Casablanca-Settat", onssa: { number: "ONSSA/26/0412", expiresOn: "2027-03-15" } },
  house: { name: "Bâtiment 1", areaM2: 1000 },
  strainName: "Ross 308",
  batch: { id: batchId, farmId: "farm", houseId: "h1", species: "broiler", strainId: "ross-308", dayOldWeightGrams: null, placedOn: "2026-09-21", chicksPlaced: 10000, deadOnArrival: 0, hatchery: "Couvoir Chaouia", deliveryNote: "CC-26-0974", status: "closed", closedOn: "2026-11-03", chickUnitPriceCentimes: "450", costCentimes: "27080000" },
  dailyEntries: [
    { id: "d1", batchId, day: "2026-10-25", dead: 370, deathCause: "unknown", culled: 6, feed: { stockItemId: "f", grams: 1_500_000 }, waterMl: 2_850_000, note: null }, // the batch so far
    { id: "d2", batchId, day: "2026-10-26", dead: 4, deathCause: "leg", culled: 0, feed: { stockItemId: "f", grams: 1_520_000 }, waterMl: 2_890_000, note: null },
    { id: "d3", batchId, day: "2026-11-01", dead: 0, deathCause: null, culled: 0, feed: null, waterMl: null, note: null },
  ],
  vaccinations: [
    { id: "v1", batchId, dayOfAge: 14, dueOn: "2026-10-05", productId: "gumboro", method: "drinkingWater", done: { on: "2026-10-05", stockItemId: "s-gum", doses: 10000, method: "drinkingWater", byUserId: "u" } },
    { id: "v2", batchId, dayOfAge: 18, dueOn: "2026-10-09", productId: "nd", method: "drinkingWater", done: null },
  ],
  treatments: [
    { id: "t1", batchId, stockItemId: "s-enro", quantity: 2000, dose: "1 ml/L", startOn: "2026-10-22", endOn: "2026-10-26", reason: "boiterie", prescriber: "Dr Naïma R.", withdrawalDays: 5, withdrawalEndsOn: "2026-10-31", byUserId: "u" },
  ],
  vetVisits: [{ id: "vv", batchId, on: "2026-10-22", vetName: "Dr Naïma R.", notes: "Boiteries, enrofloxacine 5 jours", byUserId: "u" }],
  soldBirds: [{ id: "0199a1b2-sale-1", batchId, day: "2026-11-01", birds: 4000, liveWeightGrams: 9_840_000 }],
  sales: [{ id: "0199a1b2-sale-1", batchId, buyerId: "abattoir", day: "2026-11-01", birds: 4000, farmWeightGrams: 9_840_000, buyerWeightGrams: null, pricePerKgCentimes: "1330", amountCentimes: "13087200" }],
  buyers: [{ id: "abattoir", name: "Abattoir Doukkala" }], // BuyerDto has more; the register reads the name
  disposals: [{ id: "x", farmId: "farm", day: "2026-10-26", batchId, birds: 4, weightGrams: 9800, method: "other", methodNote: "fosse fermée" }],
  labReports: [{ id: "lab", title: "Sérologie Gumboro", category: "labReport", farmId: null, issuedOn: "2026-10-12", expiresOn: null, notes: null, fileId: null }],
  products: [{ id: "gumboro", name: "Gumboro (vaccin)" }, { id: "nd", name: "Newcastle (rappel)" }],
  stockItems: [{ id: "s-gum", name: "Gumboro Nobilis", lot: "L2609" }, { id: "s-enro", name: "Enrofloxacine 10 %", lot: "E771" }],
  ...over,
});

describe("buildRegister", () => {
  it("cover: farm, authorization, house, strain, origin of the chicks", () => {
    expect(buildRegister(input()).cover).toEqual({
      farmName: "Ferme El Kheir",
      address: "Ouled Said, Settat, Casablanca-Settat",
      onssa: { number: "ONSSA/26/0412", expiresOn: "2027-03-15" },
      house: "Bâtiment 1",
      areaM2: 1000,
      strain: "Ross 308",
      hatchery: "Couvoir Chaouia",
      deliveryNote: "CC-26-0974",
      placedOn: "2026-09-21",
      chicksPlaced: 10000,
      deadOnArrival: 0,
      closedOn: "2026-11-03",
    });
  });

  it("daily rows: birds on hand after the day's deaths, culls and birds out; the treatment running that day", () => {
    const days = buildRegister(input()).days;
    expect(days.map((d) => [d.day, d.age, d.onHand, d.dead])).toEqual([
      ["2026-10-25", 34, 9624, 370],
      ["2026-10-26", 35, 9620, 4], // canvas row "9 620 · 4"
      ["2026-11-01", 41, 5620, 0], // 4 000 birds left that day
    ]);
    expect(days[1]).toMatchObject({ cause: "leg", culled: 0, feedGrams: 1_520_000, waterMl: 2_890_000, treatments: ["Enrofloxacine 10 %"], withdrawal: true });
    expect(days[2]).toMatchObject({ treatments: [], withdrawal: false, out: 4000 });
  });

  it("vaccinations with product lot and method; treatments with their withdrawal end", () => {
    const r = buildRegister(input());
    expect(r.vaccinations).toEqual([
      { age: 14, dueOn: "2026-10-05", product: "Gumboro (vaccin)", method: "drinkingWater", done: { on: "2026-10-05", item: "Gumboro Nobilis", lot: "L2609", doses: 10000 } },
      { age: 18, dueOn: "2026-10-09", product: "Newcastle (rappel)", method: "drinkingWater", done: null },
    ]);
    expect(r.treatments).toEqual([
      { product: "Enrofloxacine 10 %", lot: "E771", dose: "1 ml/L", startOn: "2026-10-22", endOn: "2026-10-26", ageFrom: 31, ageTo: 35, reason: "boiterie", prescriber: "Dr Naïma R.", withdrawalEndsOn: "2026-10-31" },
    ]);
    expect(r.vetVisits).toEqual([{ on: "2026-10-22", vetName: "Dr Naïma R.", notes: "Boiteries, enrofloxacine 5 jours" }]);
  });

  it("birds out with the buyer and origin document number, disposals, lab reports during the batch", () => {
    const r = buildRegister(input());
    expect(r.birdsOut).toEqual([{ day: "2026-11-01", birds: 4000, liveWeightGrams: 9_840_000, buyer: "Abattoir Doukkala", originNumber: "0199A1B2" }]);
    expect(r.disposals).toEqual([{ day: "2026-10-26", birds: 4, weightGrams: 9800, method: "other", methodNote: "fosse fermée" }]);
    expect(r.labReports).toEqual([{ title: "Sérologie Gumboro", issuedOn: "2026-10-12", fileId: null }]);
  });

  it("a worker's phone has no sales: birds out still show, without buyer; no money ever reaches the register", () => {
    const r = buildRegister(input({ sales: [], buyers: [] }));
    expect(r.birdsOut[0]).toMatchObject({ buyer: null, originNumber: "0199A1B2" });
    expect(JSON.stringify(buildRegister(input()))).not.toMatch(/Centimes|1330|13087200|27080000/);
  });
});
