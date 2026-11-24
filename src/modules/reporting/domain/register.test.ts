import { describe, expect, it } from "vitest";
import { buildRegister, monthsBetween, type RegisterInput } from "./register";

// SPEC-m2-compliance RP1 (arrêté n° 2126-05), §8 fixtures: the canvas batch B-2026-13 (Ross 308, 10 000 chicks on 21 Sept 2026).
const batchId = "b-13";
const input = (over: Partial<RegisterInput> = {}): RegisterInput => ({
  today: "2026-11-23",
  farm: { name: "Ferme El Kheir", commune: "Ouled Said", province: "Settat", region: "Casablanca-Settat", onssa: { number: "ONSSA/26/0412", expiresOn: "2027-03-15" } },
  house: { name: "Bâtiment 1", areaM2: 1000 },
  strainName: "Ross 308",
  batch: { id: batchId, farmId: "farm", houseId: "h1", species: "broiler", strainId: "ross-308", dayOldWeightGrams: null, placedOn: "2026-09-21", chicksPlaced: 10000, deadOnArrival: 0, hatchery: "Couvoir Chaouia", deliveryNote: "CC-26-0974", status: "closed", closedOn: "2026-11-03", chickUnitPriceCentimes: "450", costCentimes: "27080000" },
  dailyEntries: [
    { id: "d1", batchId, day: "2026-10-25", dead: 370, deathCause: "unknown", culled: 6, feed: { stockItemId: "f", grams: 1_500_000 }, waterMl: 2_850_000, note: null }, // the batch so far
    { id: "d2", batchId, day: "2026-10-26", dead: 4, deathCause: "leg", culled: 0, feed: { stockItemId: "f", grams: 1_520_000 }, waterMl: 2_890_000, note: null },
    { id: "d3", batchId, day: "2026-11-01", dead: 0, deathCause: null, culled: 0, feed: null, waterMl: null, note: null },
  ],
  eggsLaid: [],
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
  documents: [{ id: "lab", title: "Sérologie Gumboro", category: "labReport", farmId: null, issuedOn: "2026-10-12", expiresOn: null, notes: null, fileId: null }, { id: "vc", title: "Contrat Dr Naïma R.", category: "vetContract", farmId: "farm", issuedOn: "2026-01-02", expiresOn: "2026-12-31", notes: null, fileId: "f" }],
  products: [{ id: "gumboro", name: "Gumboro (vaccin)" }, { id: "nd", name: "Newcastle (rappel)" }],
  stockItems: [{ id: "s-gum", name: "Gumboro Nobilis", lot: "L2609" }, { id: "s-enro", name: "Enrofloxacine 10 %", lot: "E771" }],
  ...over,
});

describe("buildRegister", () => {
  it("cover (art. 3): authorization, farm, hatchery, house, species and strain, placement", () => {
    expect(buildRegister(input()).cover).toEqual({
      farmName: "Ferme El Kheir",
      address: "Ouled Said, Settat, Casablanca-Settat",
      onssa: { number: "ONSSA/26/0412", expiresOn: "2027-03-15" },
      house: "Bâtiment 1",
      areaM2: 1000,
      species: "broiler",
      strain: "Ross 308",
      hatchery: "Couvoir Chaouia",
      deliveryNote: "CC-26-0974",
      placedOn: "2026-09-21",
      chicksPlaced: 10000,
      deadOnArrival: 0,
      closedOn: "2026-11-03",
      // a farm stored before the register's fields: lines left to fill by hand
      holder: null,
      vet: null,
      technician: null,
      chickImportApproval: null,
      keepers: [],
    });
  });

  it("cover (art. 3): the holder, vet sanitaire, technician, agrément and keepers set on the farm", () => {
    // Made-up people: the fields are the arrêté's, the values only test the mechanics.
    const farm = {
      ...input().farm,
      holder: { name: "Ahmed Bennani", address: "12 rue des Oliviers, Settat" },
      vet: { name: "Dr Naïma R.", address: "Cabinet vétérinaire, Berrechid", phone: "0612345678" },
      technicianName: "Youssef Amrani",
      chickImportApproval: "AGR-IMP-0042",
      registerKeepers: [{ name: "Karim Idrissi", position: "Chef d’élevage", from: "2026-01-01", to: null }],
    };
    expect(buildRegister(input({ farm })).cover).toMatchObject({
      holder: farm.holder,
      vet: farm.vet,
      technician: "Youssef Amrani",
      chickImportApproval: "AGR-IMP-0042",
      keepers: farm.registerKeepers,
    });
    const blank = { ...farm, holder: null, vet: null, technicianName: null, chickImportApproval: null, registerKeepers: [] };
    expect(buildRegister(input({ farm: blank })).cover).toMatchObject({ holder: null, vet: null, technician: null, chickImportApproval: null, keepers: [] });
  });

  it("supervision sheet (art. 2): the farm's vet contract from the vault", () => {
    expect(buildRegister(input()).vetContracts).toEqual([{ title: "Contrat Dr Naïma R.", issuedOn: "2026-01-02", expiresOn: "2026-12-31" }]);
    expect(buildRegister(input({ documents: [] })).vetContracts).toEqual([]); // a worker's phone
  });

  it("daily rows (art. 4): birds on hand, daily and cumulative mortality, the treatment running that day", () => {
    const days = buildRegister(input()).days;
    expect(days.map((d) => [d.day, d.age, d.onHand, d.dead, d.cumulativeDead])).toEqual([
      ["2026-10-25", 34, 9624, 370, 376], // dead and culled
      ["2026-10-26", 35, 9620, 4, 380], // canvas row "9 620 · 4"
      ["2026-11-01", 41, 5620, 0, 380], // 4 000 birds left that day
    ]);
    expect(days[1]).toMatchObject({ cause: "leg", culled: 0, waterMl: 2_890_000, treatments: ["Enrofloxacine 10 %"], withdrawal: true });
    expect(days[2]).toMatchObject({ treatments: [], withdrawal: false, out: 4000 });
  });

  it("daily rows: birds on hand start from the birds started, free chicks included (SPEC-m3 B10)", () => {
    const days = buildRegister(input({ batch: { ...input().batch, freeChicks: 200, deadOnArrival: 50 } })).days;
    expect(days.map((d) => d.onHand)).toEqual([9774, 9770, 5770]); // 10 000 + 200 free − 50 on arrival − 376 …
  });

  it("daily rows: a sale on a day nobody entered still takes its birds off the birds on hand", () => {
    const soldBirds = [{ id: "sale-0", batchId, day: "2026-10-28", birds: 1000, liveWeightGrams: 2_300_000 }, ...input().soldBirds];
    const days = buildRegister(input({ soldBirds })).days;
    expect(days.map((d) => [d.day, d.age, d.onHand, d.dead, d.culled, d.out, d.cumulativeDead])).toEqual([
      ["2026-10-25", 34, 9624, 370, 6, 0, 376],
      ["2026-10-26", 35, 9620, 4, 0, 0, 380],
      ["2026-10-28", 37, 8620, 0, 0, 1000, 380], // no daily entry that day
      ["2026-11-01", 41, 4620, 0, 0, 4000, 380],
    ]);
    expect(days[2]).toMatchObject({ cause: null, feedGrams: [null], waterMl: null, note: null });
  });

  it("daily rows: the birds' age for a batch placed older than a day (SPEC-m3 B7)", () => {
    const batch = { ...input().batch, species: "layer" as const, ageAtPlacementDays: 126 }; // point-of-lay hens
    expect(buildRegister(input({ batch })).days.map((d) => d.age)).toEqual([160, 161, 167]);
  });

  it("daily rows: one feed column per feed type, the observations, the day's vet visit and lab report", () => {
    const r = buildRegister(
      input({
        stockItems: [...input().stockItems, { id: "f", name: "Aliment croissance", lot: null }, { id: "g", name: "Aliment finition", lot: null }],
        dailyEntries: [
          { id: "d1", batchId, day: "2026-10-12", dead: 2, deathCause: null, culled: 0, feed: { stockItemId: "f", grams: 900_000 }, waterMl: null, note: "plumes ébouriffées" },
          { id: "d2", batchId, day: "2026-10-22", dead: 3, deathCause: null, culled: 0, feed: { stockItemId: "g", grams: 1_400_000 }, waterMl: null, note: null },
          { id: "d3", batchId, day: "2026-10-23", dead: 1, deathCause: null, culled: 0, feed: null, waterMl: null, note: null },
        ],
      }),
    );
    expect(r.feedTypes).toEqual(["Aliment croissance", "Aliment finition"]);
    expect(r.days.map((d) => d.feedGrams)).toEqual([[900_000, null], [null, 1_400_000], [null, null], [null, null]]); // + the sale's day
    expect(r.days[0]).toMatchObject({ note: "plumes ébouriffées", labReports: ["Sérologie Gumboro"], vetVisits: [] });
    expect(r.days[1]).toMatchObject({ vetVisits: ["Dr Naïma R."], labReports: [] });
    expect(buildRegister(input()).feedTypes).toEqual(["—"]); // one feed, unknown item: one column
  });

  it("daily eggs for a laying batch only", () => {
    const eggsLaid = [{ batchId, day: "2026-10-26", eggs: 8000 }, { batchId, day: "2026-10-26", eggs: 120 }, { batchId: "other", day: "2026-10-26", eggs: 5 }];
    expect(buildRegister(input({ eggsLaid, batch: { ...input().batch, species: "layer" } })).days.map((d) => d.eggs)).toEqual([null, 8120, null]);
    expect(buildRegister(input({ eggsLaid })).days.map((d) => d.eggs)).toEqual([null, null, null]);
  });

  it("vaccinations (arrêté n° 3308-17 art. 14): vaccine, commercial name, lot, date, number of birds", () => {
    const r = buildRegister(input());
    expect(r.vaccinations).toEqual([
      { age: 14, dueOn: "2026-10-05", product: "Gumboro (vaccin)", method: "drinkingWater", done: { on: "2026-10-05", item: "Gumboro Nobilis", lot: "L2609", doses: 10000 } },
      { age: 18, dueOn: "2026-10-09", product: "Newcastle (rappel)", method: "drinkingWater", done: null },
    ]);
    expect(r.treatments).toEqual([
      // route and prescription reference: none on a treatment recorded before them
      { product: "Enrofloxacine 10 %", lot: "E771", dose: "1 ml/L", startOn: "2026-10-22", endOn: "2026-10-26", reason: "boiterie", prescriber: "Dr Naïma R.", prescriptionRef: null, route: null, routeNote: null, withdrawalEndsOn: "2026-10-31" },
    ]);
  });

  it("treatments (art. 4): the route of administration and the prescription's reference, as entered", () => {
    const treatments = [{ ...input().treatments[0], route: "drinkingWater" as const, routeNote: null, prescriptionRef: "ORD-2026-118" }];
    expect(buildRegister(input({ treatments })).treatments[0]).toMatchObject({ route: "drinkingWater", routeNote: null, prescriptionRef: "ORD-2026-118" });
    const other = [{ ...treatments[0], route: "other" as const, routeNote: "au pinceau" }];
    expect(buildRegister(input({ treatments: other })).treatments[0]).toMatchObject({ route: "other", routeNote: "au pinceau" });
  });

  it("vet visas (art. 7): each recorded visit, then one blank row per month of the batch's life", () => {
    expect(buildRegister(input()).visas).toEqual([
      { month: "2026-09", on: null, vetName: null, notes: null },
      { month: "2026-10", on: "2026-10-22", vetName: "Dr Naïma R.", notes: "Boiteries, enrofloxacine 5 jours" },
      { month: "2026-10", on: null, vetName: null, notes: null },
      { month: "2026-11", on: null, vetName: null, notes: null },
    ]);
    const open = { ...input().batch, status: "open" as const, closedOn: undefined };
    expect(buildRegister(input({ batch: open, today: "2027-01-04" })).visas.filter((v) => v.on === null).map((v) => v.month)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
    expect(monthsBetween("2026-12-30", "2027-02-01")).toEqual(["2026-12", "2027-01", "2027-02"]);
  });

  it("birds out with the buyer and origin document number, disposals, lab reports during the batch", () => {
    const r = buildRegister(input());
    expect(r.birdsOut).toEqual([{ day: "2026-11-01", birds: 4000, liveWeightGrams: 9_840_000, buyer: "Abattoir Doukkala", buyerAddress: null, destination: null, originNumber: "0199A1B2" }]);
    expect(r.disposals).toEqual([{ day: "2026-10-26", birds: 4, weightGrams: 9800, method: "other", methodNote: "fosse fermée" }]);
    expect(r.labReports).toEqual([{ title: "Sérologie Gumboro", issuedOn: "2026-10-12", fileId: null }]);
  });

  it("birds out (art. 4): the buyer's address and, when not the buyer's, where the birds went", () => {
    const destination = { name: "Abattoir Atlas, site de Berrechid", address: "Zone industrielle, Berrechid" };
    const r = buildRegister(input({ buyers: [{ id: "abattoir", name: "Abattoir Doukkala", address: "Route d’El Jadida, Safi" }], sales: [{ ...input().sales[0], destination }] }));
    expect(r.birdsOut[0]).toMatchObject({ buyer: "Abattoir Doukkala", buyerAddress: "Route d’El Jadida, Safi", destination });
  });

  it("annexes (art. 2, 5): the copies to file, lab reports in the vault once scanned", () => {
    expect(buildRegister(input()).annexes).toEqual([
      { key: "chickDelivery", references: ["CC-26-0974"], inVault: false },
      { key: "feedDelivery", references: [], inVault: false },
      { key: "labReports", references: ["Sérologie Gumboro"], inVault: false },
      { key: "vetReports", references: [], inVault: false },
      { key: "prescriptions", references: [], inVault: false },
    ]);
    const scanned = input().documents.map((d) => ({ ...d, fileId: "f" }));
    expect(buildRegister(input({ documents: scanned })).annexes[2]).toMatchObject({ inVault: true });
  });

  it("a worker's phone has no sales: birds out still show, without buyer; no money ever reaches the register", () => {
    const r = buildRegister(input({ sales: [], buyers: [] }));
    expect(r.birdsOut[0]).toMatchObject({ buyer: null, buyerAddress: null, destination: null, originNumber: "0199A1B2" });
    expect(JSON.stringify(buildRegister(input()))).not.toMatch(/Centimes|1330|13087200|27080000/);
  });
});
