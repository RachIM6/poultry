import { addFarmDays, farmDayOf, farmInstant, type FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { confirmLoan, createFixedAsset, createLoan, createSubsidy, payLoanInstallment, payPlacement, postPending, recordAssociateMovement, saveBudget } from "@/modules/finance";
import { planFor } from "@/modules/health/shared";
import { attendanceId, taskAssignmentId, taskDoneId } from "@/modules/workforce/schema";
import { ago, apply, at, dh, id, m, must, place, purchase, raise, rear, sale, today, tonnes, weighings, type Feed, type Mutation } from "./kit";
import { importStatement, loanInstallmentsDue } from "./money";

// ══ The individual farm (receipts-and-expenses book): every use case of the product, on two farms. ══
// The figures are made up to look plausible: DEMO ONLY, never a reference (no breeder curve, no vaccine schedule, no
// SMAG or contribution rate, no climate target). The vaccination programme and the climate targets below are typed by
// the demo farmer and say so: they are not the reference data's, which ship without lines (OQ4).

export type Staff = { manager: string; worker: string }; // the phones of the members linked to two employees

export async function fillIndividual(A: TenantContext, staff: Staff) {
  const a = {
    farm: id(), h1: id(), h2: id(), h3: id(), feedCo: id(), vetCo: id(),
    starter: id(), grower: id(), finisher: id(), layerFeed: id(), medicine: id(), ndv: id(), ib: id(), gumboro: id(),
    closed: id(), closed2: id(), open: id(), layers: id(), plan: id(), cash: id(), bank: id(), protocol: id(),
    butcher: id(), abattoir: id(), trader: id(), grocer: id(), eggTrader: id(), market: id(),
    said: id(), youssef: id(), routine: id(), cleanout: id(), cleanout2: id(), powerCut: id(), targets: id(),
    // the second farm: pullets, turkeys and a beldi flock
    farm2: id(), pulletHouse: id(), turkeyHouse: id(), beldiRun: id(), pulletFeed: id(), turkeyFeed: id(), beldiFeed: id(),
    pullets: id(), turkeys: id(), beldi: id(), plan2: id(), khadija: id(),
  };
  const feedA: Feed = { starter: a.starter, grower: a.grower, finisher: a.finisher };

  // The first closed batch: 8 000 chicks in house 1, sold at 40–42 days (the last sale closes it), then a clean-out.
  const closedOn = ago(100);
  const closedDay = (age: number) => addFarmDays(closedOn, age);
  const closed = raise(a.closed, closedOn, 8000 - 12, 42, feedA, { 40: 2000, 41: 3000 });
  // The second closed batch: 7 000 chicks in house 2, sold three weeks ago; its house is being cleaned out.
  const closed2On = ago(60);
  const c2Day = (age: number) => addFarmDays(closed2On, age);
  const taken = 20; // birds the farmer took home (FC7)
  const closed2 = raise(a.closed2, closed2On, 7000 - Math.round(7000 * 0.0015), 42, feedA, { 40: 3000, 41: 2000 });
  // The open batch: house 1 again, day 24 today; day 15 was never entered, and today's entry is left for the presentation.
  const openOn = ago(24);
  const openDay = (age: number) => addFarmDays(openOn, age);
  const open = raise(a.open, openOn, 8000 - 12, 23, feedA, {}, [15]);
  // The laying flock: 5 000 point-of-lay hens at 22 weeks, three weeks ago, in house 3.
  const layersOn = ago(21);
  const hens = 5000;

  const layerDays: Mutation[] = [];
  const collections: Mutation[] = [];
  let layerFeedUsed = 0;
  let eggsLaid = 0;
  const laidOn: Record<FarmDay, number> = {};
  for (let age = 0, alive = hens; age < 21; age++) {
    const day = addFarmDays(layersOn, age);
    const dead = age % 5 === 2 ? 2 : 1;
    alive -= dead;
    const grams = alive * 115; // made up
    layerFeedUsed += grams;
    layerDays.push(m("flock.recordDay", { batchId: a.layers, day, changes: { dead, deathCause: "unknown", culled: 0, feed: { stockItemId: a.layerFeed, grams }, waterMl: grams * 2, note: null } }));
    const laid = Math.round(alive * (0.86 + age * 0.003)); // a rising lay, made up
    const counts = { normal: laid - 95, cracked: 40, dirty: 30, doubleYolk: 8, floor: 12, broken: 5 };
    eggsLaid += counts.normal;
    laidOn[day] = counts.normal;
    collections.push(m("eggs.recordCollection", { id: id(), batchId: a.layers, day, counts, sample: { count: 30, grams: 30 * 61 } }));
  }
  // The day before yesterday's eggs graded (E3), part of them sold by grade; a few downgraded eggs thrown away.
  const gradedDay = ago(2);
  const grades = { s: 500, m: 1_700, l: 1_300, xl: 300 };
  const graded = Object.values(grades).reduce((s, n) => s + n, 0);
  if (graded > laidOn[gradedDay]) throw new Error("demo: more eggs graded than laid that day");
  const eggGrading = [
    m("eggs.gradeEggs", { id: id(), batchId: a.layers, laidOn: gradedDay, grades }),
    m("eggs.discardEggs", { id: id(), batchId: a.layers, laidOn: ago(5), item: "downgraded", eggs: 45, reason: "Œufs fêlés et sales, non vendables (démo)", day: ago(4) }),
  ];
  // Egg sales every three days, by the tray of 30; the rest stays in stock.
  const eggSales = [19, 16, 13, 10, 7, 4, 1].map((n, i) => {
    const eggs = 11_400;
    const cash = i % 2 === 0;
    const total = (BigInt(eggs) * 3600n * 2n + 30n) / 60n;
    return m("sales.recordEggSale", { id: id(), batchId: a.layers, buyerId: cash ? a.grocer : a.eggTrader, day: ago(n), lines: [{ item: "ungraded", eggs, eggsPerTray: 30, unitPriceCentimes: "3600" }], paymentMethod: cash ? "cash" : "credit", paidCentimes: cash ? String(total) : "0", instrument: null });
  });
  const gradedLines = [{ item: "grade:m", eggs: 1_200, eggsPerTray: 30, unitPriceCentimes: "3900" }, { item: "grade:l", eggs: 900, eggsPerTray: 30, unitPriceCentimes: "4200" }];
  const gradedTotal = gradedLines.reduce((s, l) => s + (BigInt(l.eggs) * BigInt(l.unitPriceCentimes) * 2n + 30n) / 60n, 0n);
  eggSales.push(m("sales.recordEggSale", { id: id(), batchId: a.layers, buyerId: a.grocer, day: ago(1), lines: gradedLines, paymentMethod: "cash", paidCentimes: String(gradedTotal), instrument: null }));
  eggSales.push(m("sales.recordEggSale", { id: id(), batchId: a.layers, buyerId: a.market, day: ago(3), lines: [{ item: "downgraded", eggs: 900, eggsPerTray: 30, unitPriceCentimes: "2400" }], paymentMethod: "cash", paidCentimes: String(900 * 80), instrument: null })); // the cracked and dirty, cheaper
  if (7 * 11_400 + graded >= eggsLaid) throw new Error("demo: more eggs sold than laid");

  // Feed bought ahead of each phase; the grower left after the open batch's entries falls under its alert threshold.
  const growerLeft = 700_000;
  const vaccinesOn = addFarmDays(closedOn, -1);
  const buyFeed = [
    purchase(a.feedCo, a.starter, "kg", addFarmDays(closedOn, -2), tonnes(closed.used[a.starter]), "560", "all"),
    purchase(a.feedCo, a.grower, "kg", closedDay(9), tonnes(closed.used[a.grower]), "540", "all"),
    purchase(a.feedCo, a.finisher, "kg", closedDay(23), tonnes(closed.used[a.finisher]), "520", 6_000_000n, "transfer", closedDay(60)), // half now, the rest late
    purchase(a.feedCo, a.starter, "kg", addFarmDays(closed2On, -2), tonnes(closed2.used[a.starter]), "560", "all"),
    purchase(a.feedCo, a.grower, "kg", c2Day(9), tonnes(closed2.used[a.grower]), "545", "all"),
    purchase(a.feedCo, a.finisher, "kg", c2Day(23), tonnes(closed2.used[a.finisher]), "525", "all"),
    purchase(a.feedCo, a.starter, "kg", addFarmDays(openOn, -2), tonnes(open.used[a.starter] - (tonnes(closed.used[a.starter]) - closed.used[a.starter])), "560", "all"),
  ];
  const growerStock = tonnes(closed.used[a.grower]) - closed.used[a.grower];
  buyFeed.push(purchase(a.feedCo, a.grower, "kg", openDay(9), Math.max(1_000_000, open.used[a.grower] - growerStock + growerLeft), "545", "all"));
  const finisherOnCredit = purchase(a.feedCo, a.finisher, "kg", ago(2), 24_000_000, "525", "none", "cash", addFarmDays(today, 28)); // on credit, due in four weeks
  buyFeed.push(finisherOnCredit);
  buyFeed.push(purchase(a.feedCo, a.layerFeed, "kg", addFarmDays(layersOn, -1), tonnes(layerFeedUsed) + 3_000_000, "480", "all"));
  // Vaccines and medicine from the veterinary pharmacy, on credit; paid later by a post-dated cheque.
  const vetBuys = [
    purchase(a.vetCo, a.medicine, "ml", closedDay(10), 2000, "35", "all", "cash"),
    purchase(a.vetCo, a.ndv, "dose", vaccinesOn, 60_000, "12", "none", "cash", ago(70)),
    purchase(a.vetCo, a.ib, "dose", vaccinesOn, 25_000, "14", "none", "cash", ago(70)),
    purchase(a.vetCo, a.gumboro, "dose", vaccinesOn, 50_000, "15", "none", "cash", ago(70)),
  ];
  const vetOwed = (60_000 * 12 + 25_000 * 14 + 50_000 * 15) / 100; // DH
  const issuedCheque = id();
  const supplierPayments = [
    m("inventory.recordSupplierPayment", { id: issuedCheque, supplierId: a.vetCo, day: ago(72), amountCentimes: dh(vetOwed), method: "cheque", instrument: { number: "CHQ-ÉMIS-DEMO-0101", dueOn: ago(70) } }),
    m("inventory.debitIssued", { id: id(), instrumentId: issuedCheque, day: ago(69) }),
    m("inventory.recordSupplierPayment", { id: id(), supplierId: a.feedCo, day: ago(1), amountCentimes: dh(60_000), method: "bill", instrument: { number: "EFF-DEMO-0201", dueOn: addFarmDays(today, 25) } }), // half of the finisher on credit, by an accepted bill
  ];

  // The farmer's own vaccination programme (OQ4: typed by the demo farmer, NOT a schedule to follow).
  const programme = [
    { dayOfAge: 1, productId: "vaccine-newcastle", method: "spray" },
    { dayOfAge: 1, productId: "vaccine-infectious-bronchitis", method: "spray" },
    { dayOfAge: 12, productId: "vaccine-gumboro", method: "drinkingWater" },
    { dayOfAge: 18, productId: "vaccine-newcastle", method: "drinkingWater" },
    { dayOfAge: 26, productId: "vaccine-gumboro", method: "drinkingWater" },
  ] as const;
  const lots: Record<string, string> = { "vaccine-newcastle": a.ndv, "vaccine-infectious-bronchitis": a.ib, "vaccine-gumboro": a.gumboro };
  /** The batch's plan, and each line due by `doneBy` marked done on its day. The line due after `doneBy` stays to do. */
  const vaccinate = (batchId: string, placedOn: FarmDay, birds: number, doneBy: FarmDay) => [
    m("health.planVaccinations", { batchId, protocolId: a.protocol, items: programme }),
    ...planFor(batchId, placedOn, [...programme])
      .filter((v) => v.dueOn <= doneBy)
      .map((v) => m("health.recordVaccination", { id: v.id, on: v.dueOn, stockItemId: lots[v.productId], doses: birds, method: v.method })),
  ];

  const finalBirds = closed.alive; // the last buyer takes what is left
  const attendanceMonth = ago(Number(today.slice(8, 10))).slice(0, 7); // last month
  const monthDays = Array.from({ length: 31 }, (_, i) => `${attendanceMonth}-${String(i + 1).padStart(2, "0")}`).filter((d) => farmDayOf(new Date(`${d}T12:00:00Z`)) === d);
  const presence = (employeeId: string, day: string, i: number) => {
    const friday = new Date(`${day}T12:00:00Z`).getUTCDay() === 5;
    const status = friday ? "rest" : employeeId === a.youssef && i === 10 ? "leave" : employeeId === a.khadija && i === 6 ? "absent" : "present";
    return m("workforce.setAttendance", { id: attendanceId(employeeId, day), employeeId, day, status, arrivedAt: status === "present" ? (i % 7 === 3 ? "07:25" : "07:00") : null });
  };
  const thisMonth = Array.from({ length: Number(today.slice(8, 10)) - 1 }, (_, i) => `${today.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`);
  const payDay = thisMonth[2] ?? today;
  const routineKey = `routine:${a.routine}`;
  const oneOff = { done: id(), todo: id(), farm2: id() };

  const register = {
    holder: { name: "Exploitant Démo", address: null },
    vet: { name: "Dr Vétérinaire Démo", address: "Ben Ahmed (adresse fictive)", phone: null },
    technicianName: "Technicien Démo",
    registerKeepers: [{ name: "Saïd Démo", position: "Chef d'équipe", from: ago(200), to: null }],
  };

  const farmA: Mutation[] = [
    m("farm-registry.createFarm", { id: a.farm, name: "Ferme Démo Ben Ahmed", region: "Casablanca-Settat", province: "Settat", commune: "Ben Ahmed", gps: null, onssa: { number: "DEMO-ONSSA-0001", expiresOn: addFarmDays(today, 25) }, ...register }),
    m("farm-registry.createHouse", { id: a.h1, farmId: a.farm, name: "Bâtiment 1", areaM2: 1000, capacity: 10000, type: "closed" }),
    m("farm-registry.createHouse", { id: a.h2, farmId: a.farm, name: "Bâtiment 2", areaM2: 800, capacity: 8000, type: "closed" }),
    m("farm-registry.createHouse", { id: a.h3, farmId: a.farm, name: "Bâtiment pondeuses", areaM2: 700, capacity: 6000, type: "closed" }),
    m("farm-registry.createFarm", { id: a.farm2, name: "Ferme Démo Tiflet", region: "Rabat-Salé-Kénitra", province: "Khémisset", commune: "Tiflet", gps: null, onssa: { number: "DEMO-ONSSA-0003", expiresOn: addFarmDays(today, 210) }, ...register, registerKeepers: [{ name: "Khadija Démo", position: "Ouvrière", from: ago(120), to: null }] }),
    m("farm-registry.createHouse", { id: a.pulletHouse, farmId: a.farm2, name: "Poussinière", areaM2: 600, capacity: 6000, type: "closed" }),
    m("farm-registry.createHouse", { id: a.turkeyHouse, farmId: a.farm2, name: "Bâtiment dindes", areaM2: 900, capacity: 4000, type: "open" }),
    m("farm-registry.createHouse", { id: a.beldiRun, farmId: a.farm2, name: "Parcours beldi", areaM2: 400, capacity: 2500, type: "open" }),
    m("finance.createTreasuryAccount", { id: a.cash, kind: "cash", name: "Caisse de la ferme" }),
    m("finance.createTreasuryAccount", { id: a.bank, kind: "bank", name: "Banque Démo" }),
    m("inventory.createSupplier", { id: a.feedCo, name: "Provende Démo du Centre", phone: null }),
    m("inventory.createSupplier", { id: a.vetCo, name: "Pharmacie vétérinaire Démo", phone: null }),
    m("inventory.createStockItem", { id: a.starter, farmId: a.farm, productId: "feed-starter", kind: "feed", name: "Aliment démarrage", unit: "kg", lot: null, expiresOn: null }),
    m("inventory.createStockItem", { id: a.grower, farmId: a.farm, productId: "feed-grower", kind: "feed", name: "Aliment croissance", unit: "kg", lot: null, expiresOn: null, lowStockThreshold: 2_000_000 }),
    m("inventory.createStockItem", { id: a.finisher, farmId: a.farm, productId: "feed-finisher", kind: "feed", name: "Aliment finition", unit: "kg", lot: null, expiresOn: null, lowStockThreshold: 3_000_000 }),
    m("inventory.createStockItem", { id: a.layerFeed, farmId: a.farm, productId: null, kind: "feed", name: "Aliment pondeuse", unit: "kg", lot: null, expiresOn: null, lowStockThreshold: 2_000_000 }),
    m("inventory.createStockItem", { id: a.medicine, farmId: a.farm, productId: null, kind: "medicine", name: "Antibiotique (ordonnance démo)", unit: "ml", lot: "LOT-DEMO-1", expiresOn: addFarmDays(today, 300) }),
    m("inventory.createStockItem", { id: a.ndv, farmId: a.farm, productId: "vaccine-newcastle", kind: "vaccine", name: "Vaccin Newcastle (démo)", unit: "dose", lot: "NDV-DEMO-26", expiresOn: addFarmDays(today, 45), lowStockThreshold: 10_000 }),
    m("inventory.createStockItem", { id: a.ib, farmId: a.farm, productId: "vaccine-infectious-bronchitis", kind: "vaccine", name: "Vaccin bronchite infectieuse (démo)", unit: "dose", lot: "IB-DEMO-26", expiresOn: addFarmDays(today, 120) }),
    m("inventory.createStockItem", { id: a.gumboro, farmId: a.farm, productId: "vaccine-gumboro", kind: "vaccine", name: "Vaccin Gumboro (démo)", unit: "dose", lot: "IBD-DEMO-26", expiresOn: addFarmDays(today, 160) }),
    m("inventory.createStockItem", { id: a.pulletFeed, farmId: a.farm2, productId: null, kind: "feed", name: "Aliment poulette", unit: "kg", lot: null, expiresOn: null, lowStockThreshold: 500_000 }),
    m("inventory.createStockItem", { id: a.turkeyFeed, farmId: a.farm2, productId: null, kind: "feed", name: "Aliment dinde", unit: "kg", lot: null, expiresOn: null }),
    m("inventory.createStockItem", { id: a.beldiFeed, farmId: a.farm2, productId: null, kind: "feed", name: "Aliment beldi", unit: "kg", lot: null, expiresOn: null }),
    m("sales.createBuyer", { id: a.butcher, name: "Boucherie Démo Ben Ahmed", phone: null, type: "trader" }),
    m("sales.createBuyer", { id: a.abattoir, name: "Abattoir Démo Settat", phone: null, type: "abattoir", address: "Zone industrielle, Settat (fictif)" }),
    m("sales.createBuyer", { id: a.trader, name: "Hamid, marchand (démo)", phone: null, type: "trader" }),
    m("sales.createBuyer", { id: a.grocer, name: "Épicerie Démo", phone: null, type: "other" }),
    m("sales.createBuyer", { id: a.eggTrader, name: "Grossiste œufs Démo", phone: null, type: "trader" }),
    m("sales.createBuyer", { id: a.market, name: "Souk hebdomadaire Démo", phone: null, type: "market" }),
    m("workforce.createEmployee", { id: a.said, farmId: a.farm, name: "Saïd Démo", job: "lead", phone: staff.manager, housedOnFarm: true, startedOn: ago(200), leftOn: null, dailyWageCentimes: "13000", cnssNumber: null, houseIds: [a.h1, a.h2] }),
    m("workforce.createEmployee", { id: a.youssef, farmId: a.farm, name: "Youssef Démo", job: "worker", phone: staff.worker, housedOnFarm: false, startedOn: ago(150), leftOn: null, dailyWageCentimes: "11000", cnssNumber: null, houseIds: [a.h3] }),
    m("workforce.createEmployee", { id: a.khadija, farmId: a.farm2, name: "Khadija Démo", job: "worker", phone: null, housedOnFarm: false, startedOn: ago(120), leftOn: null, dailyWageCentimes: "11000", cnssNumber: null, houseIds: [a.pulletHouse, a.turkeyHouse, a.beldiRun] }),
    m("documents.createDocument", { id: id(), title: "Autorisation sanitaire ONSSA (démo)", category: "authorization", farmId: a.farm, issuedOn: ago(340), expiresOn: addFarmDays(today, 25), notes: "Numéro fictif DEMO-ONSSA-0001" }),
    m("documents.createDocument", { id: id(), title: "Autorisation sanitaire ONSSA, Tiflet (démo)", category: "authorization", farmId: a.farm2, issuedOn: ago(155), expiresOn: addFarmDays(today, 210), notes: "Numéro fictif DEMO-ONSSA-0003" }),
    m("documents.createDocument", { id: id(), title: "Contrat vétérinaire sanitaire (démo)", category: "vetContract", farmId: a.farm, issuedOn: ago(200), expiresOn: addFarmDays(today, 165), notes: null }),
    m("documents.createDocument", { id: id(), title: "Assurance des bâtiments (démo)", category: "insurance", farmId: a.farm, issuedOn: ago(370), expiresOn: ago(5), notes: "À renouveler" }),
    m("documents.createDocument", { id: id(), title: "Analyse d'eau (démo)", category: "labReport", farmId: a.farm, issuedOn: ago(40), expiresOn: null, notes: null }),
    m("documents.createDocument", { id: id(), title: "Bail du terrain de Tiflet (démo)", category: "land", farmId: a.farm2, issuedOn: ago(400), expiresOn: addFarmDays(today, 330), notes: "Bail fictif de démonstration" }),
    m("documents.createDocument", { id: id(), title: "Contrôle du groupe électrogène (démo)", category: "equipment", farmId: a.farm, issuedOn: ago(355), expiresOn: addFarmDays(today, 10), notes: null }),
  ];

  // The farmer's programme and climate targets: typed by the demo farmer (made up, OQ4), never the app's defaults.
  const settings: Mutation[] = [
    m("reference-data.copyProtocol", { id: a.protocol, templateId: "broiler-default", name: "Programme du vétérinaire (démo, fictif)" }),
    m("reference-data.updateProtocol", { id: a.protocol, changes: { items: programme } }),
    m("climate.saveTargets", {
      id: a.targets,
      validFrom: ago(130),
      source: "Valeurs fictives de démonstration, à remplacer par celles du vétérinaire",
      productionType: null,
      bands: [
        { fromAge: 0, toAge: 7, temperatureMinTenths: 300, temperatureMaxTenths: 340, humidityMin: 55, humidityMax: 70, ammoniaMax: 15 },
        { fromAge: 8, toAge: 21, temperatureMinTenths: 240, temperatureMaxTenths: 300, humidityMin: 55, humidityMax: 70, ammoniaMax: 20 },
        { fromAge: 22, toAge: 800, temperatureMinTenths: 180, temperatureMaxTenths: 280, humidityMin: 50, humidityMax: 70, ammoniaMax: 20 },
      ],
    }),
    m("planning.saveDowntime", { id: id(), farmId: a.farm, validFrom: ago(200), minDays: 21, source: "Choix de l'exploitant, au-delà du minimum réglementaire (démo)" }),
  ];

  const money: Mutation[] = [
    m("finance.recordTransfer", { id: id(), day: ago(103), amountCentimes: dh(60_000), fromId: a.bank, toId: a.cash }), // cash for the chicks and the daily costs
    m("finance.recordExpense", { id: id(), day: ago(85), category: "electricity", amountCentimes: dh(3_850), paidFrom: "bank", treasuryId: a.bank, note: "Facture ONEE (démo)" }),
    m("finance.recordExpense", { id: id(), day: ago(55), category: "electricity", amountCentimes: dh(3_420), paidFrom: "bank", treasuryId: a.bank, note: "Facture ONEE (démo)" }),
    m("finance.recordExpense", { id: id(), day: ago(25), category: "electricity", amountCentimes: dh(3_960), paidFrom: "bank", treasuryId: a.bank, note: "Facture ONEE (démo)" }),
    m("finance.recordExpense", { id: id(), day: ago(40), category: "water", amountCentimes: dh(640), paidFrom: "cash", treasuryId: a.cash, note: null }),
    m("finance.recordExpense", { id: id(), day: closedDay(42), category: "catching", amountCentimes: dh(2_300), paidFrom: "cash", treasuryId: a.cash, note: "Équipe de ramassage", batchId: a.closed }),
    m("finance.recordExpense", { id: id(), day: c2Day(42), category: "catching", amountCentimes: dh(2_100), paidFrom: "cash", treasuryId: a.cash, note: "Équipe de ramassage", batchId: a.closed2 }),
    m("finance.recordExpense", { id: id(), day: closedDay(14), category: "vet_fees", amountCentimes: dh(600), paidFrom: "cash", treasuryId: a.cash, note: "Visite et ordonnance", batchId: a.closed }),
    m("finance.recordExpense", { id: id(), day: openDay(18), category: "vet_fees", amountCentimes: dh(800), paidFrom: "credit", treasuryId: null, note: "Visite et ordonnance, à payer", batchId: a.open }),
    m("finance.recordExpense", { id: id(), day: ago(30), category: "bank_fees", amountCentimes: dh(45), paidFrom: "bank", treasuryId: a.bank, note: null }),
    m("finance.recordExpense", { id: id(), day: ago(65), category: "insurance", amountCentimes: dh(2_800), paidFrom: "credit", treasuryId: null, note: "Assurance du bâtiment dindes, à payer (démo)" }),
    m("finance.recordTransfer", { id: id(), day: closedDay(43), amountCentimes: dh(8_000), fromId: a.cash, toId: a.bank }), // what the box held over
    m("finance.recordTransfer", { id: id(), day: ago(5), amountCentimes: dh(250_000), fromId: a.cash, toId: a.bank }), // the cash sales, deposited
    m("finance.recordTransfer", { id: id(), day: ago(62), amountCentimes: dh(45_000), fromId: a.bank, toId: a.cash }), // the second batch's chicks
    m("finance.recordTransfer", { id: id(), day: ago(51), amountCentimes: dh(40_000), fromId: a.bank, toId: a.cash }), // the turkeys
  ];

  const chequeBack = id(); // a cheque that came back unpaid: the butcher may no longer buy on credit
  const sales: Mutation[] = [
    sale(a.closed, a.butcher, closedDay(40), 2000, 2_350, 1500, "cash", "all"),
    sale(a.closed, a.abattoir, closedDay(41), 3000, 2_420, 1480, "cheque", "all", { number: "CHQ-DEMO-0001", dueOn: addFarmDays(today, 6) }), // post-dated: still to remit
    sale(a.closed, a.trader, closedDay(42), finalBirds, 2_480, 1520, "credit", "none"), // closes the batch
    m("sales.recordPayment", { id: id(), buyerId: a.trader, day: closedDay(50), amountCentimes: dh(40_000), method: "cash", instrument: null }),
    m("sales.recordPayment", { id: id(), buyerId: a.trader, day: ago(20), amountCentimes: dh(25_000), method: "cheque", instrument: { number: "CHQ-DEMO-0003", dueOn: ago(12) } }),
    m("sales.setCreditLimit", { buyerId: a.trader, limitCentimes: dh(30_000) }), // he still owes more: over his limit
    m("sales.setCreditLimit", { buyerId: a.eggTrader, limitCentimes: dh(60_000) }),
    // The second closed batch: an accepted bill (effet), a cheque that bounced, birds taken home, the last sale in cash.
    sale(a.closed2, a.abattoir, c2Day(40), 3000, 2_380, 1490, "bill", "all", { number: "EFF-DEMO-0001", dueOn: addFarmDays(today, 20) }),
    sale(a.closed2, a.butcher, c2Day(41), 2000, 2_430, 1510, "cheque", "all", { number: "CHQ-DEMO-0002", dueOn: ago(10) }, chequeBack),
    m("sales.recordConsumption", { id: id(), batchId: a.closed2, day: c2Day(42), takenBy: "exploitant", kind: "live", birds: taken, farmWeightGrams: taken * 2_500, pricePerKgCentimes: null }),
    sale(a.closed2, a.trader, c2Day(42), closed2.alive - taken, 2_490, 1530, "cash", "all"), // closes the batch
  ];
  // The bounced cheque (its sale's id is the instrument's): remitted, then back unpaid.
  const trailing: Mutation[] = [
    m("sales.setInstrumentState", { id: id(), instrumentId: chequeBack, state: "remitted", day: ago(10) }),
    m("sales.setInstrumentState", { id: id(), instrumentId: chequeBack, state: "unpaid", day: ago(6) }),
  ];

  const health = (batchId: string, placedOn: FarmDay, start: number, withdrawalDays: number, ref: string) => [
    m("health.recordVetVisit", { id: id(), batchId, on: addFarmDays(placedOn, start), vetName: "Dr Vétérinaire Démo", notes: "Râles chez quelques sujets ; traitement prescrit. Visite fictive (démo)." }),
    // The withdrawal is the demo prescription's, typed as the farmer would: never a product's default.
    m("health.recordTreatment", { id: id(), batchId, stockItemId: a.medicine, quantity: 800, dose: "1 ml par litre d'eau (ordonnance démo)", startOn: addFarmDays(placedOn, start), endOn: addFarmDays(placedOn, start + 4), reason: "Troubles respiratoires (démo)", prescriber: "Dr Vétérinaire Démo", withdrawalDays, route: "drinkingWater", prescriptionRef: ref }),
  ];

  // The vet's routine rounds, at least once a month per batch: the register is signed (arrêté 2126-05, made-up visits).
  const rounds = (batchId: string, placedOn: FarmDay, ages: number[]) =>
    ages.map((age) => m("health.recordVetVisit", { id: id(), batchId, on: addFarmDays(placedOn, age), vetName: "Dr Vétérinaire Démo", notes: "Visite de routine, registre visé. Visite fictive (démo)." }));
  const layerBooster = id();

  const compliance: Mutation[] = [
    m("biosecurity.startCleanout", { id: a.cleanout, houseId: a.h1, afterBatchId: a.closed, startedOn: closedDay(44) }),
    ...(
      [["manureOut", 44, null], ["equipmentWashed", 45, null], ["pressureWash", 46, null], ["disinfection", 48, "Désinfectant (démo)"], ["rodentControl", 49, "Appât (démo)"], ["waterFlush", 50, null], ["litterPreheat", 74, null]] as const
    ).map(([step, age, product]) => m("biosecurity.recordCleanoutStep", { id: id(), cleanoutId: a.cleanout, step, day: closedDay(age), product, dose: null, productLot: null, note: null })),
    // House 2's clean-out, in progress: washed, not yet disinfected.
    m("biosecurity.startCleanout", { id: a.cleanout2, houseId: a.h2, afterBatchId: a.closed2, startedOn: c2Day(44) }),
    ...([["manureOut", 44], ["equipmentWashed", 45], ["pressureWash", 47]] as const).map(([step, age]) => m("biosecurity.recordCleanoutStep", { id: id(), cleanoutId: a.cleanout2, step, day: c2Day(age), product: null, dose: null, productLot: null, note: null })),
    m("biosecurity.recordManure", { id: id(), farmId: a.farm, day: closedDay(44), houseId: a.h1, batchId: a.closed, quantityKg: 18_000, destination: "sold", recipient: "Agriculteur voisin (démo)" }),
    m("biosecurity.recordManure", { id: id(), farmId: a.farm, day: c2Day(44), houseId: a.h2, batchId: a.closed2, quantityKg: 15_500, destination: "sold", recipient: "Agriculteur voisin (démo)" }),
    m("biosecurity.recordVisit", { id: id(), farmId: a.farm, enteredAt: at(ago(10), "09:30"), visitor: "Livreur Provende Démo", vehicle: "12345-A-6", purpose: "feedDelivery", recentFarm: true, wheelsDisinfected: true, footbath: true, farmClothing: false, zone: "dirty" }),
    m("biosecurity.recordVisit", { id: id(), farmId: a.farm, enteredAt: at(openDay(18), "10:00"), visitor: "Dr Vétérinaire Démo", vehicle: null, purpose: "vet", recentFarm: false, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "clean" }),
    m("biosecurity.recordVisit", { id: id(), farmId: a.farm, enteredAt: at(ago(2), "15:15"), visitor: "Acheteur Démo", vehicle: "67890-B-6", purpose: "buyer", recentFarm: false, wheelsDisinfected: false, footbath: true, farmClothing: false, zone: "dirty" }),
    // Today's visitor, half an hour before the seed ran (the screen lists today's).
    m("biosecurity.recordVisit", { id: id(), farmId: a.farm, enteredAt: new Date(Math.max(farmInstant(today, 1).getTime(), Date.now() - 30 * 60_000)).toISOString(), visitor: "Technicien Provende Démo", vehicle: "13579-D-6", purpose: "other", recentFarm: true, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "dirty" }),
    m("biosecurity.recordVisit", { id: id(), farmId: a.farm2, enteredAt: at(ago(6), "11:00"), visitor: "Technicien Démo", vehicle: "24680-C-6", purpose: "other", recentFarm: true, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "dirty" }),
    m("biosecurity.recordDisposal", { id: id(), farmId: a.farm, day: ago(2), batchId: a.open, birds: 9, weightGrams: 9 * 900, method: "sealedPit", methodNote: null }),
    m("biosecurity.recordDisposal", { id: id(), farmId: a.farm2, day: ago(3), batchId: a.turkeys, birds: 4, weightGrams: 4 * 3_000, method: "sealedPit", methodNote: null }),
    m("biosecurity.recordRodentCheck", { id: id(), farmId: a.farm, houseId: a.h1, day: ago(14), action: "baitPlaced", product: "Appât (démo)" }),
    m("biosecurity.recordRodentCheck", { id: id(), farmId: a.farm, houseId: a.h1, day: ago(7), action: "baitChecked", product: null }),
    m("biosecurity.recordRodentCheck", { id: id(), farmId: a.farm2, houseId: a.turkeyHouse, day: ago(9), action: "baitPlaced", product: "Appât (démo)" }),
    // House 1 at days 21–23, against the farmer's targets: the afternoons are too hot (alerts in the inbox).
    ...[3, 2, 1].flatMap((n, i) =>
      ([["08:00", 286, 62, 12], ["14:00", 301, 55, 9], ["20:00", 279, 66, 15]] as const).map(([time, t, rh, nh3]) =>
        m("climate.recordReading", { id: id(), houseId: a.h1, day: ago(n), time, temperatureTenths: t - i * 4, humidity: rh, ammonia: nh3 }),
      ),
    ),
    // The turkeys' open house: within the targets.
    ...[3, 2, 1].flatMap((n) =>
      ([["08:00", 205, 64], ["15:00", 243, 58]] as const).map(([time, t, rh]) => m("climate.recordReading", { id: id(), houseId: a.turkeyHouse, day: ago(n), time, temperatureTenths: t, humidity: rh, ammonia: null })),
    ),
    m("climate.startPowerCut", { id: a.powerCut, farmId: a.farm, startedAt: at(ago(4), "10:05") }),
    m("climate.endPowerCut", { id: a.powerCut, endedAt: at(ago(4), "12:35"), generatorStarted: true, generatorSeconds: 2 * 3600 + 20 * 60, dieselMl: 18_000 }),
  ];

  const team: Mutation[] = [
    ...monthDays.flatMap((d, i) => [presence(a.said, d, i), presence(a.youssef, d, i), presence(a.khadija, d, i)]),
    m("workforce.validatePay", { farmId: a.farm, month: attendanceMonth }),
    m("workforce.payWages", { farmId: a.farm, month: attendanceMonth, day: payDay, paidFrom: "cash" }),
    m("workforce.validatePay", { farmId: a.farm2, month: attendanceMonth }),
    m("workforce.payWages", { farmId: a.farm2, month: attendanceMonth, day: payDay, paidFrom: "bank" }),
    ...thisMonth.flatMap((d, i) => [presence(a.said, d, i), presence(a.youssef, d, i + 1), presence(a.khadija, d, i + 2)]),
    m("workforce.recordAdvance", { id: id(), employeeId: a.youssef, day: thisMonth.at(-1) ?? today, amountCentimes: dh(500), deductMonth: today.slice(0, 7), note: "Avance (démo)" }),
    m("workforce.recordAdvance", { id: id(), employeeId: a.khadija, day: thisMonth[0] ?? today, amountCentimes: dh(300), deductMonth: today.slice(0, 7), note: "Avance (démo)" }),
    m("workforce.addStaffRecord", { id: id(), employeeId: a.youssef, day: ago(40), kind: "training", topic: "biosecurity", note: "Pédiluve, tenue et sens de circulation (démo)" }),
    m("workforce.addStaffRecord", { id: id(), employeeId: a.khadija, day: ago(35), kind: "training", topic: "vaccination", note: "Vaccination à l'eau de boisson (démo)" }),
    m("workforce.addStaffRecord", { id: id(), employeeId: a.said, day: ago(20), kind: "accident", note: "Entorse en déchargeant l'aliment (démo)", daysOff: 2 }),
    m("workforce.saveRoutine", { id: a.routine, farmId: a.farm, houseId: null, employeeId: a.said, title: "Contrôler les abreuvoirs et les pipettes", time: "07:30", everyDays: 1, startOn: ago(30), fromAge: null, stopOn: null }),
    m("workforce.saveRoutine", { id: id(), farmId: a.farm, houseId: a.h3, employeeId: a.youssef, title: "Ramasser les œufs (2ᵉ passage)", time: "14:00", everyDays: 1, startOn: ago(20), fromAge: null, stopOn: null }),
    m("workforce.saveRoutine", { id: id(), farmId: a.farm2, houseId: a.turkeyHouse, employeeId: a.khadija, title: "Rabattre les rideaux le soir", time: "18:30", everyDays: 1, startOn: ago(45), fromAge: null, stopOn: null }),
    ...[2, 1].map((n) => m("workforce.tickTask", { id: taskDoneId(routineKey, ago(n)), farmId: a.farm, key: routineKey, day: ago(n) })),
    m("workforce.addTask", { id: oneOff.done, farmId: a.farm, houseId: a.h2, employeeId: a.youssef, day: ago(1), title: "Vider la fosse à fumier du bâtiment 2", time: "09:00" }),
    m("workforce.tickTask", { id: taskDoneId(`oneoff:${oneOff.done}`, ago(1)), farmId: a.farm, key: `oneoff:${oneOff.done}`, day: ago(1) }),
    m("workforce.addTask", { id: oneOff.todo, farmId: a.farm, houseId: a.h2, employeeId: a.said, day: today, title: "Désinfecter le bâtiment 2", time: "08:00" }),
    m("workforce.addTask", { id: oneOff.farm2, farmId: a.farm2, houseId: null, employeeId: a.khadija, day: today, title: "Recevoir la livraison d'aliment", time: "10:00" }),
    // Today's routine given to Youssef: Saïd is on the clean-out.
    m("workforce.assignTask", { id: taskAssignmentId(A.organizationId, routineKey, today), farmId: a.farm, key: routineKey, day: today, employeeId: a.youssef }),
  ];

  // ── The second farm: a pullet batch and turkeys mid-cycle, a beldi flock sold by the head. ──
  const pulletsOn = ago(70);
  const pullets = rear(a.pullets, pulletsOn, 3000 - 6, 69, { feed: () => a.pulletFeed, gramsPerBird: (age) => Math.round(8 + 0.75 * age), deadPerMille: (age) => (age <= 7 ? 1.2 : 0.15) });
  const turkeysOn = ago(50);
  const turkeys = rear(a.turkeys, turkeysOn, 1500 - 3, 49, { feed: () => a.turkeyFeed, gramsPerBird: (age) => Math.round(15 + 4.4 * age), deadPerMille: (age) => (age <= 7 ? 2 : 0.5) });
  const beldiOn = ago(150);
  const beldiDay = (age: number) => addFarmDays(beldiOn, age);
  const beldi = rear(a.beldi, beldiOn, 2000 - 4, 95, { feed: () => a.beldiFeed, gramsPerBird: (age) => Math.round(8 + 1.1 * age), deadPerMille: (age) => (age <= 7 ? 1.5 : 0.3), sold: { 90: 900 } });
  const headSale = (day: FarmDay, buyerId: string, lines: { item: string; birds: number; pricePerHeadCentimes: string }[], paymentMethod: string, paid: boolean) => {
    const total = lines.reduce((s, l) => s + BigInt(l.birds) * BigInt(l.pricePerHeadCentimes), 0n);
    return m("sales.recordHeadSale", { id: id(), batchId: a.beldi, buyerId, day, lines, farmWeightGrams: null, paymentMethod, paidCentimes: paid ? String(total) : "0", instrument: null });
  };
  const farm2: Mutation[] = [
    purchase(a.feedCo, a.beldiFeed, "kg", addFarmDays(beldiOn, -1), tonnes(beldi.used[a.beldiFeed]) + 1_000_000, "470", "all", "transfer"),
    m("flock.placeBatch", { id: a.beldi, houseId: a.beldiRun, species: "beldi", strainId: "unspecified-beldi", placedOn: beldiOn, chicksPlaced: 2000, deadOnArrival: 4, hatchery: "Couvoir beldi Démo", deliveryNote: "BL-DEMO-401", chickUnitPriceCentimes: "400", dayOldWeightGrams: 36 }),
    ...beldi.entries,
    ...weighings(a.beldi, beldiOn, [[30, 380], [60, 1_050], [90, 1_750]]),
    ...rounds(a.beldi, beldiOn, [5, 30, 60, 88]),
    headSale(beldiDay(90), a.market, [{ item: "rooster", birds: 450, pricePerHeadCentimes: "9000" }, { item: "hen", birds: 450, pricePerHeadCentimes: "7000" }], "cash", true),
    headSale(beldiDay(95), a.grocer, [{ item: "bird", birds: beldi.alive, pricePerHeadCentimes: "8000" }], "credit", false), // closes the batch, still owed in part
    m("sales.recordPayment", { id: id(), buyerId: a.grocer, day: ago(30), amountCentimes: dh(30_000), method: "transfer", instrument: null }),
    purchase(a.feedCo, a.pulletFeed, "kg", addFarmDays(pulletsOn, -1), tonnes(pullets.used[a.pulletFeed]) + 200_000, "500", "all", "transfer"),
    m("flock.placeBatch", { id: a.pullets, houseId: a.pulletHouse, species: "pullet", strainId: "lohmann-brown", placedOn: pulletsOn, chicksPlaced: 3000, deadOnArrival: 6, hatchery: "Couvoir Démo", deliveryNote: "BL-DEMO-501", chickUnitPriceCentimes: "950", dayOldWeightGrams: 38 }),
    ...pullets.entries,
    ...weighings(a.pullets, pulletsOn, [[14, 125], [28, 290], [42, 510], [56, 720]]),
    ...rounds(a.pullets, pulletsOn, [3, 30, 60]),
    purchase(a.feedCo, a.turkeyFeed, "kg", addFarmDays(turkeysOn, -1), tonnes(turkeys.used[a.turkeyFeed]) + 2_000_000, "590", 3_000_000n, "transfer", ago(20)), // part paid, the rest late
    m("flock.placeBatch", { id: a.turkeys, houseId: a.turkeyHouse, species: "turkey", strainId: "but-6", placedOn: turkeysOn, chicksPlaced: 1500, deadOnArrival: 3, hatchery: "Couvoir dindes Démo", deliveryNote: "BL-DEMO-601", chickUnitPriceCentimes: "1800", dayOldWeightGrams: 58, paidOnDelivery: { cashAccountId: a.cash, amountCentimes: String(1500 * 1800) } }),
    ...turkeys.entries,
    ...weighings(a.turkeys, turkeysOn, [[7, 165], [21, 690], [35, 1_650], [49, 2_900]]),
    ...rounds(a.turkeys, turkeysOn, [3, 45]),
    m("health.recordVetVisit", { id: id(), batchId: a.turkeys, on: ago(20), vetName: "Dr Vétérinaire Démo", notes: "Bon état général, quelques boiteries. Visite fictive (démo)." }),
    m("planning.savePlan", { id: a.plan2, houseId: a.beldiRun, placeOn: addFarmDays(today, 20), chicks: 2000, strainId: "unspecified-beldi", hatchery: "Couvoir beldi Démo", chickPriceCentimes: "420", saleAge: 95 }),
  ];

  // Prices seen at the souk and from suppliers, every week for two months (made up).
  const prices: Mutation[] = Array.from({ length: 9 }, (_, w) => w * 7 + 1).flatMap((n, w) =>
    ([["chick", 520 + (w % 3) * 15], ["feed", 535 - (w % 2) * 10], ["liveBroiler", 1_420 + ((w * 37) % 140)], ["egg", 118 + (w % 4) * 3], ["cullHen", 3_500 + (w % 3) * 200]] as const).map(([product, c]) =>
      m("market-prices.recordPrice", { id: id(), product, day: ago(n), priceCentimes: String(c), seenOn: w % 2 === 0 ? "Souk de Ben Ahmed (démo)" : "Fournisseur (démo)" }),
    ),
  );

  const writes = await apply(A, "individual", [
    ...farmA,
    ...settings,
    ...vetBuys,
    ...buyFeed,
    place(a.closed, a.h1, closedOn, 8000, "BL-DEMO-101", { paidOnDelivery: { cashAccountId: a.cash, amountCentimes: String(8000 * 550) } }),
    ...closed.entries,
    ...vaccinate(a.closed, closedOn, 7_900, closedDay(42)),
    ...weighings(a.closed, closedOn, [[7, 170], [14, 430], [21, 850], [28, 1_350], [35, 1_900], [42, 2_450]]),
    ...health(a.closed, closedOn, 12, 5, "ORD-DEMO-01"),
    ...rounds(a.closed, closedOn, [2, 30, 41]),
    place(a.closed2, a.h2, closed2On, 7000, "BL-DEMO-103", { paidOnDelivery: { cashAccountId: a.cash, amountCentimes: String(7000 * 560) }, chickUnitPriceCentimes: "560" }),
    ...closed2.entries,
    ...vaccinate(a.closed2, closed2On, 6_900, c2Day(42)),
    ...rounds(a.closed2, closed2On, [2, 16, 30, 41]),
    ...weighings(a.closed2, closed2On, [[7, 168], [14, 425], [21, 860], [28, 1_370], [35, 1_930], [42, 2_470]]),
    ...sales,
    place(a.open, a.h1, openOn, 8000, "BL-DEMO-102"), // chicks partly paid: a debt on the money view
    ...open.entries,
    ...vaccinate(a.open, openOn, 7_900, today), // the day-26 booster is due in two days
    ...weighings(a.open, openOn, [[7, 165], [14, 420], [21, 830]]),
    ...health(a.open, openOn, 18, 7, "ORD-DEMO-02"), // withdrawal still running today
    ...rounds(a.open, openOn, [2]),
    m("flock.placeBatch", { id: a.layers, houseId: a.h3, species: "layer", strainId: "lohmann-brown", placedOn: layersOn, chicksPlaced: hens, deadOnArrival: 0, hatchery: "Élevage de poulettes Démo", deliveryNote: "BL-DEMO-201", chickUnitPriceCentimes: "5500", dayOldWeightGrams: null, ageAtPlacementDays: 154 }),
    ...layerDays,
    ...collections,
    ...rounds(a.layers, layersOn, [1, 15]),
    // The hens' Newcastle booster, added to their plan by hand (OQ4: the farmer's, not a schedule), done a week ago.
    m("health.addVaccination", { id: layerBooster, batchId: a.layers, dayOfAge: 154 + 14, productId: "vaccine-newcastle", method: "drinkingWater" }),
    m("health.recordVaccination", { id: layerBooster, on: addFarmDays(layersOn, 14), stockItemId: a.ndv, doses: 4_980, method: "drinkingWater" }),
    ...eggGrading,
    ...eggSales,
    m("inventory.adjustStock", { id: id(), stockItemId: a.layerFeed, day: ago(6), quantity: -40_000, reason: "Sac déchiré par les rongeurs (démo)" }),
    ...farm2,
    m("planning.savePlan", { id: a.plan, houseId: a.h2, placeOn: addFarmDays(today, 12), chicks: 7000, strainId: "ross-308", hatchery: "Couvoir Démo", chickPriceCentimes: "560", saleAge: 42 }),
    ...supplierPayments,
    ...money,
    ...trailing,
    ...compliance,
    ...team,
    ...prices,
  ]);

  // ── What the owner types online: contributions, budgets, the loan, the fixed assets and their subsidy. ──
  must("contribution", await recordAssociateMovement(A, { id: id(), day: ago(170), direction: "contribution", amountCentimes: dh(900_000), treasuryId: a.bank, associate: null }));
  must("withdrawal", await recordAssociateMovement(A, { id: id(), day: ago(15), direction: "withdrawal", amountCentimes: dh(6_000), treasuryId: a.cash, associate: null }));
  must("budget", await saveBudget(A, { id: id(), name: "Bande en cours, bâtiment 1 (démo)", basedOn: null, batchId: a.open, chicks: "8000", chickPriceCentimes: "550", feedGrams: "35000000", feedPricePerKgCentimes: "535", otherCostCentimes: dh(18_000), plannedGrams: "18800000", salePricePerKgCentimes: "1500", saleDay: "42" }));
  must("planned budget", await saveBudget(A, { id: id(), name: "Bande planifiée, bâtiment 2 (démo)", basedOn: a.closed2, chicks: "7000", chickPriceCentimes: "560", feedGrams: "30500000", feedPricePerKgCentimes: "540", otherCostCentimes: dh(15_000), plannedGrams: "16900000", salePricePerKgCentimes: "1520", saleDay: null }));
  const loan = id();
  must("loan", await createLoan(A, { id: loan, lender: "Banque Démo (crédit d'équipement)", treasuryId: a.bank, principalCentimes: dh(180_000), disbursedOn: ago(160), rate: 5_500, frequency: "monthly", installments: 48, deferral: 0, firstDueOn: ago(130) }));
  must("loan confirmed", await confirmLoan(A, { loanId: loan }));
  for (const [number, day] of await loanInstallmentsDue(loan)) must(`installment ${number}`, await payLoanInstallment(A, { loanId: loan, number, day }));
  const drinkers = id();
  must("asset", await createFixedAsset(A, { id: drinkers, label: "Lignes d'abreuvement et mangeoires, bâtiment 2 (démo)", category: "equipment", farmId: a.farm, houseId: a.h2, acquiredOn: ago(158), inServiceOn: ago(156), amountCentimes: dh(96_000), lifeMonths: 84, paidWith: "transfer", treasuryId: a.bank }));
  must("asset", await createFixedAsset(A, { id: id(), label: "Groupe électrogène 60 kVA (démo)", category: "installation", farmId: a.farm, acquiredOn: ago(90), inServiceOn: ago(90), amountCentimes: dh(64_000), lifeMonths: 120, paidWith: "cheque", treasuryId: a.bank }));
  must("asset", await createFixedAsset(A, { id: id(), label: "Extension du bâtiment pondeuses (démo)", category: "building", farmId: a.farm, houseId: a.h3, acquiredOn: ago(140), inServiceOn: ago(25), amountCentimes: dh(150_000), lifeMonths: 240, paidWith: "transfer", treasuryId: a.bank }));
  must("subsidy", await createSubsidy(A, { id: id(), label: "Aide à l'équipement des élevages (démo)", grantor: "Fonds de développement agricole (démo)", amountCentimes: dh(28_800), receivedOn: ago(45), treasuryId: a.bank, assetIds: [drinkers] }));

  await postPending(A); // the books, as the push route does after a phone's push
  // The open batch's chicks, partly paid: the debt is read from the posted placement.
  must("placement payment", await payPlacement(A, { id: id(), batchId: a.open, day: ago(10), amountCentimes: dh(20_000), paidWith: "transfer", treasuryId: a.bank }));
  must("placement payment", await payPlacement(A, { id: id(), batchId: a.layers, day: ago(4), amountCentimes: dh(150_000), paidWith: "transfer", treasuryId: a.bank }));
  const statement = await importStatement(A, a.bank, ago(20), 15_000n); // three weeks ago, partly ticked
  return { writes, statement };
}
