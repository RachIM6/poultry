import { addFarmDays, daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { confirmLoan, createFixedAsset, createLoan, createSubsidy, payLoanInstallment, payPlacement, recordAssociateMovement, saveBudget } from "@/modules/finance";
import { taskAssignmentId, taskDoneId } from "@/modules/workforce/schema";
import { at, id } from "../kit";
import { BELDI, BROILER, cleanout, cold, grow, hot, LAYER, curve, need, PULLET, rounds, treat, TURKEY, vaccinate, type Farmhand, type Needs, type ProtocolLine, type SalePlan } from "./flocks";
import { price } from "./market";
import { buy, payStatements, receivables, supply, team, treasurer, type Credit, type Employee, type Supplier } from "./money";
import { play, prng, RANK, Story, type Actor, type Rng } from "./story";

// ══ The individual farm's long history (receipts-and-expenses book): two farms, six houses, every module, from the
// first day of the story to today. Made-up people, buyers and suppliers; plausible figures. ══

export const FARM_NAMES = ["Ferme Ennakhil", "Ferme Aïn Sbit"];
export type People = { manager: string; worker: string; vetName: string };

const VET_NOTES = [
  "Visite de routine : état général bon, litière sèche, registre visé.",
  "Visite de routine : homogénéité correcte, abreuvement vérifié, registre visé.",
  "Visite de routine : aucun signe clinique, ventilation à surveiller par temps chaud.",
  "Visite de routine : consommation d'eau normale, plan de vaccination respecté.",
];

/** A month's bill-sized amount: the base, more in the heat (fans) and the cold (brooding), give or take. */
const seasonal = (rng: Rng, day: FarmDay, base: number) => Math.round(base * (hot(day) ? 1.35 : cold(day) ? 1.2 : 1) * rng.around(1, 0.08) / 100) * 100;

export async function fillFarmHistory(owner: TenantContext, people: { manager: TenantContext; worker: TenantContext; vet: TenantContext }, staff: People, from: FarmDay, today: FarmDay) {
  const story = new Story(from, today);
  const rng = prng("lpri");
  const T = (n: number) => addFarmDays(today, -n);
  const F = (n: number) => addFarmDays(from, n);
  const needs: Needs = new Map();
  let paperNo = 0;
  const instrument = (kind: "cheque" | "bill") => (kind === "cheque" ? `${3_418_200 + ++paperNo * 7}` : `LCN ${String(52_300 + ++paperNo).padStart(7, "0")}`);

  const a = {
    farm1: id(), farm2: id(), b1: id(), b2: id(), layerHouse: id(), pulletHouse: id(), turkeyHouse: id(), beldiRun: id(),
    cash: id(), bank: id(), feedCo: id(), vetCo: id(), depot: id(),
    starter: id(), grower: id(), finisher: id(), layerFeed: id(), pulletFeed: id(), turkeyStart: id(), turkeyGrow: id(), beldiFeed: id(),
    litter1: id(), gas1: id(), litter2: id(), medicine: id(), medicine2: id(),
    abattoir: id(), chevillard: id(), marchand: id(), rotisserie: id(), eggTrader: id(), grocer: id(), souk: id(), reform: id(), turkeyAbattoir: id(), soukTiflet: id(), restaurant: id(),
    broilerPlan: id(), pulletPlan: id(), turkeyPlan: id(), beldiPlan: id(), layerPlan: id(), targets: id(),
    hamid: id(), brahim: id(), mustapha: id(), fatima: id(), abdellah: id(),
  };
  const feedCo: Supplier = { id: a.feedCo, credit: true };
  const vetCo: Supplier = { id: a.vetCo, credit: false };
  const depot: Supplier = { id: a.depot, credit: false };
  const units: Record<string, "kg" | "ml" | "dose" | "unit"> = {};
  const item = (key: string, farmId: string, kind: string, name: string, unit: "kg" | "ml" | "dose" | "unit", productId: string | null = null, lot: string | null = null, expiresOn: string | null = null, day = from) => {
    units[key] = unit;
    story.add(day, RANK.setup, "manager", "inventory.createStockItem", { id: key, farmId, productId, kind, name, unit, lot, expiresOn });
  };

  // ── The farms, as the owner set them up on the first day. ──
  const register = (keeper: string, position: string) => ({
    holder: { name: "LPRI", address: "Douar Ouled Fares, commune de Ben Ahmed, province de Settat" },
    vet: { name: staff.vetName, address: "Cabinet vétérinaire, avenue Hassan II, Settat", phone: null },
    technicianName: "Hamid Ouazzani",
    registerKeepers: [{ name: keeper, position, from, to: null }],
  });
  const setup: [string, object][] = [
    ["farm-registry.createFarm", { id: a.farm1, name: FARM_NAMES[0], region: "Casablanca-Settat", province: "Settat", commune: "Ben Ahmed", gps: null, onssa: { number: "AS 11.23.0417", expiresOn: addFarmDays(today, 25) }, ...register("Hamid Ouazzani", "Chef d'élevage") }],
    ["farm-registry.createHouse", { id: a.b1, farmId: a.farm1, name: "Bâtiment 1", areaM2: 1000, capacity: 10000, type: "closed" }],
    ["farm-registry.createHouse", { id: a.b2, farmId: a.farm1, name: "Bâtiment 2", areaM2: 800, capacity: 8000, type: "closed" }],
    ["farm-registry.createHouse", { id: a.layerHouse, farmId: a.farm1, name: "Bâtiment pondeuses", areaM2: 750, capacity: 6000, type: "closed" }],
    ["farm-registry.createFarm", { id: a.farm2, name: FARM_NAMES[1], region: "Rabat-Salé-Kénitra", province: "Khémisset", commune: "Aïn Sbit", gps: null, onssa: { number: "AS 04.24.1182", expiresOn: "2027-09-09" }, ...register("Fatima Zahra Amrani", "Ouvrière chargée du registre") }],
    ["farm-registry.createHouse", { id: a.pulletHouse, farmId: a.farm2, name: "Poussinière", areaM2: 600, capacity: 6000, type: "closed" }],
    ["farm-registry.createHouse", { id: a.turkeyHouse, farmId: a.farm2, name: "Bâtiment dindes", areaM2: 900, capacity: 4000, type: "open" }],
    ["farm-registry.createHouse", { id: a.beldiRun, farmId: a.farm2, name: "Parcours beldi", areaM2: 400, capacity: 2500, type: "open" }],
    ["finance.createTreasuryAccount", { id: a.cash, kind: "cash", name: "Caisse de la ferme" }],
    ["finance.createTreasuryAccount", { id: a.bank, kind: "bank", name: "Compte courant, agence de Ben Ahmed" }],
    ["inventory.createSupplier", { id: a.feedCo, name: "Provenderie Oum Errabia", phone: null }],
    ["inventory.createSupplier", { id: a.vetCo, name: "Pharmacie vétérinaire Al Wifaq, Settat", phone: null }],
    ["inventory.createSupplier", { id: a.depot, name: "Dépôt Al Massira (paille et gaz), Ben Ahmed", phone: null }],
    ["sales.createBuyer", { id: a.abattoir, name: "Abattoir de volailles Al Fajr, Settat", phone: null, type: "abattoir", address: "Zone industrielle, route de Casablanca, Settat" }],
    ["sales.createBuyer", { id: a.chevillard, name: "Hamid Boukili, chevillard", phone: null, type: "trader", address: "Marché de gros, Ben Ahmed" }],
    ["sales.createBuyer", { id: a.marchand, name: "Mohamed Lahrichi, marchand de volailles", phone: null, type: "trader", address: "Derb Sultan, Casablanca" }],
    ["sales.createBuyer", { id: a.rotisserie, name: "Rôtisserie Al Wafa, Berrechid", phone: null, type: "other" }],
    ["sales.createBuyer", { id: a.eggTrader, name: "Grossiste en œufs Benjelloun, Derb Omar", phone: null, type: "trader" }],
    ["sales.createBuyer", { id: a.grocer, name: "Épicerie Assalam, Ben Ahmed", phone: null, type: "other" }],
    ["sales.createBuyer", { id: a.souk, name: "Souk hebdomadaire de Ben Ahmed", phone: null, type: "market" }],
    ["sales.createBuyer", { id: a.reform, name: "Abdelkader Senhaji, poules de réforme", phone: null, type: "trader" }],
    ["sales.createBuyer", { id: a.turkeyAbattoir, name: "Abattoir avicole Zemmour, Khémisset", phone: null, type: "abattoir", address: "Route de Tiflet, Khémisset" }],
    ["sales.createBuyer", { id: a.soukTiflet, name: "Souk hebdomadaire de Tiflet", phone: null, type: "market" }],
    ["sales.createBuyer", { id: a.restaurant, name: "Restaurant Dar Zitoune, Rabat", phone: null, type: "other" }],
  ];
  for (const [type, payload] of setup) story.add(from, RANK.setup, "manager", type, payload);
  item(a.starter, a.farm1, "feed", "Aliment démarrage (miettes)", "kg", "feed-starter");
  item(a.grower, a.farm1, "feed", "Aliment croissance (granulés)", "kg", "feed-grower");
  item(a.finisher, a.farm1, "feed", "Aliment finition (granulés)", "kg", "feed-finisher");
  item(a.layerFeed, a.farm1, "feed", "Aliment pondeuse", "kg");
  item(a.pulletFeed, a.farm2, "feed", "Aliment poulette", "kg");
  item(a.turkeyStart, a.farm2, "feed", "Aliment dinde démarrage", "kg");
  item(a.turkeyGrow, a.farm2, "feed", "Aliment dinde croissance", "kg");
  item(a.beldiFeed, a.farm2, "feed", "Aliment volaille beldi", "kg");
  item(a.litter1, a.farm1, "litter", "Paille broyée", "kg");
  item(a.gas1, a.farm1, "gas", "Propane, bouteille de 34 kg", "unit");
  item(a.litter2, a.farm2, "litter", "Copeaux de bois", "kg");
  item(a.medicine, a.farm1, "medicine", "Enrofloxacine 10 %, solution buvable", "ml", null, "ENR-25-0318", "2026-09-30");
  item(a.medicine2, a.farm2, "medicine", "Amoxicilline 50 %, poudre orale (ml de solution)", "ml", null, "AMX-25-1102", "2027-03-31");

  // The farmer's programmes, as the vet wrote them (OQ4: the farm's own, never the app's).
  const broilerProgramme: ProtocolLine[] = [
    { dayOfAge: 1, productId: "vaccine-newcastle", method: "spray" },
    { dayOfAge: 1, productId: "vaccine-infectious-bronchitis", method: "spray" },
    { dayOfAge: 12, productId: "vaccine-gumboro", method: "drinkingWater" },
    { dayOfAge: 18, productId: "vaccine-newcastle", method: "drinkingWater" },
    { dayOfAge: 26, productId: "vaccine-gumboro", method: "drinkingWater" },
  ];
  const pulletProgramme: ProtocolLine[] = [
    { dayOfAge: 1, productId: "vaccine-newcastle", method: "spray" },
    { dayOfAge: 1, productId: "vaccine-infectious-bronchitis", method: "spray" },
    { dayOfAge: 12, productId: "vaccine-gumboro", method: "drinkingWater" },
    { dayOfAge: 21, productId: "vaccine-newcastle", method: "drinkingWater" },
    { dayOfAge: 24, productId: "vaccine-gumboro", method: "drinkingWater" },
    { dayOfAge: 42, productId: "vaccine-infectious-bronchitis", method: "drinkingWater" },
    { dayOfAge: 56, productId: "vaccine-newcastle", method: "drinkingWater" },
    { dayOfAge: 84, productId: "vaccine-avian-influenza-h9n2", method: "injection" },
    { dayOfAge: 105, productId: "vaccine-newcastle", method: "injection" },
  ];
  const layerProgramme: ProtocolLine[] = [140, 196, 252, 308, 364, 420, 476].map((dayOfAge) => ({ dayOfAge, productId: "vaccine-newcastle", method: "drinkingWater" }));
  const turkeyProgramme: ProtocolLine[] = [
    { dayOfAge: 7, productId: "vaccine-newcastle", method: "drinkingWater" },
    { dayOfAge: 28, productId: "vaccine-newcastle", method: "drinkingWater" },
    { dayOfAge: 56, productId: "vaccine-newcastle", method: "drinkingWater" },
  ];
  const beldiProgramme: ProtocolLine[] = [
    { dayOfAge: 7, productId: "vaccine-newcastle", method: "drinkingWater" },
    { dayOfAge: 21, productId: "vaccine-gumboro", method: "drinkingWater" },
    { dayOfAge: 35, productId: "vaccine-newcastle", method: "drinkingWater" },
  ];
  for (const [planId, templateId, name, items] of [
    [a.broilerPlan, "broiler-default", "Programme poulet de chair, Dr Berrada", broilerProgramme],
    [a.pulletPlan, "pullet-default", "Programme poulettes, Dr Berrada", pulletProgramme],
    [a.layerPlan, "pullet-default", "Rappels Newcastle des pondeuses, Dr Berrada", layerProgramme],
    [a.turkeyPlan, "turkey-default", "Programme dinde, Dr Berrada", turkeyProgramme],
    [a.beldiPlan, "broiler-default", "Programme volaille beldi, Dr Berrada", beldiProgramme],
  ] as const) {
    story.add(from, RANK.setup, "manager", "reference-data.copyProtocol", { id: planId, templateId, name });
    story.add(from, RANK.setup, "manager", "reference-data.updateProtocol", { id: planId, changes: { items } });
  }
  story.add(from, RANK.setup, "owner", "climate.saveTargets", {
    id: a.targets, validFrom: from, source: "Consignes écrites du vétérinaire de l'élevage, Dr Nadia Berrada", productionType: null,
    bands: [
      { fromAge: 0, toAge: 7, temperatureMinTenths: 300, temperatureMaxTenths: 340, humidityMin: 55, humidityMax: 70, ammoniaMax: 15 },
      { fromAge: 8, toAge: 21, temperatureMinTenths: 240, temperatureMaxTenths: 300, humidityMin: 55, humidityMax: 70, ammoniaMax: 20 },
      { fromAge: 22, toAge: 800, temperatureMinTenths: 180, temperatureMaxTenths: 280, humidityMin: 50, humidityMax: 70, ammoniaMax: 20 },
    ],
  });
  for (const farmId of [a.farm1, a.farm2])
    story.add(from, RANK.setup, "owner", "planning.saveDowntime", { id: id(), farmId, validFrom: from, minDays: 21, source: "Choix de l'exploitant, au-delà du minimum réglementaire" });

  // Vaccine lots: a new lot of each vaccine every quarter, bought from the pharmacy before its first use.
  const lotNames: Record<string, [string, string]> = {
    "vaccine-newcastle": ["Vaccin Newcastle souche La Sota", "LS"],
    "vaccine-infectious-bronchitis": ["Vaccin bronchite infectieuse H120", "H120"],
    "vaccine-gumboro": ["Vaccin Gumboro souche intermédiaire", "IBD"],
    "vaccine-avian-influenza-h9n2": ["Vaccin influenza aviaire H9N2 inactivé", "H9"],
  };
  const lotIds = new Map<string, string>();
  const lotMeta = new Map<string, { productId: string; name: string; lot: string; farmId: string }>();
  const lots = (productId: string, day: FarmDay, farmId: string) => {
    const quarter = `${day.slice(0, 4)}-${Math.ceil(Number(day.slice(5, 7)) / 3)}`;
    const key = `${farmId}:${productId}:${quarter}`;
    if (!lotIds.has(key)) {
      const [name, code] = lotNames[productId];
      const itemId = id();
      lotIds.set(key, itemId);
      lotMeta.set(itemId, { productId, name, farmId, lot: `${code}-${day.slice(2, 4)}${quarter.slice(5)}${String(rng.int(10, 99))}` });
    }
    return lotIds.get(key)!;
  };
  const sales: Farmhand["sales"] = [];
  const hand = (farmId: string, who: Actor, medicine: string): Farmhand => ({
    story, rng, farmId, needs, lots, vetName: staff.vetName, hand: who, instrument, sales, medicine,
    disinfectant: { product: "Désinfectant à base de glutaraldéhyde et ammonium quaternaire", lot: `GQ-${rng.int(2_400, 2_699)}` },
  });
  const f1 = hand(a.farm1, "worker", a.medicine);
  const f2 = hand(a.farm2, "manager", a.medicine2);

  // ── Broilers, back to back in houses 1 and 2: 38–44 days, then three weeks and more of clean-out and rest. ──
  type Cycle = { placedOn: FarmDay; lastAge: number; open: boolean };
  /** The cycles of a house, from the newest (`latest`) back to the story's first days. */
  const backFrom = (latest: Cycle, rest: [number, number], length: [number, number], minStart = from) => {
    const cycles = [latest];
    for (;;) {
      const lastSale = addFarmDays(cycles[0].placedOn, -rng.int(...rest));
      const lastAge = rng.int(...length);
      const placedOn = addFarmDays(lastSale, -lastAge);
      if (placedOn < addFarmDays(minStart, 3)) return cycles;
      cycles.unshift({ placedOn, lastAge, open: false });
    }
  };
  const broilers = [
    { house: a.b1, area: 1000, size: 10_000, cycles: backFrom({ placedOn: T(24), lastAge: 24, open: true }, [22, 27], [39, 44]) },
    { house: a.b2, area: 800, size: 8_000, cycles: backFrom({ placedOn: T(20 + 42), lastAge: 42, open: false }, [22, 28], [39, 44]) },
  ];
  let bandNo = 0;
  const current: Record<string, string> = {};
  for (const { house, area, size, cycles } of broilers) {
    cycles.forEach((c, i) => {
      const batchId = id();
      const next = cycles[i + 1]?.placedOn ?? null;
      const chicks = Math.round((hot(c.placedOn) ? 0.86 : 0.96) * size / 100) * 100;
      const doa = Math.round(chicks * rng.around(0.0018, 0.4));
      const strainId = rng.chance(0.7) ? "ross-308" : "cobb-500";
      const chickPrice = price.chick(c.placedOn);
      const lastSaleAge = c.open ? 42 : c.lastAge; // an open batch sells at its planned age, after today
      const salePlans: SalePlan[] = [
        { age: lastSaleAge - 2, share: rng.around(0.35, 0.15), buyerId: a.abattoir, method: rng.chance(0.6) ? "transfer" : "cheque" },
        { age: lastSaleAge - 1, share: rng.around(0.55, 0.1), buyerId: rng.chance(0.6) ? a.chevillard : a.rotisserie, method: rng.pick(["cash", "credit", "cash"] as const) },
        { age: lastSaleAge, share: 1, buyerId: a.marchand, method: rng.pick(["cash", "credit", "cheque"] as const) },
      ];
      const isLatestB2 = house === a.b2 && i === cycles.length - 1;
      if (isLatestB2) salePlans[2] = { ...salePlans[2], buyerId: a.abattoir, method: "cheque", dueOn: addFarmDays(today, 6) }; // post-dated: still in the portfolio
      const open = c.open;
      if (open) current.b1 = batchId;
      // Chicks paid on delivery in cash, the open batch's on credit to the hatchery (paid in part below).
      story.add(c.placedOn, RANK.place, "manager", "flock.placeBatch", {
        id: batchId, houseId: house, species: "broiler", strainId, placedOn: c.placedOn, chicksPlaced: chicks, deadOnArrival: doa,
        hatchery: rng.pick(["Couvoir Al Mostakbal, Berrechid", "Couvoir Sidi Rahal"]), deliveryNote: `BL ${c.placedOn.slice(2, 4)}-${String(++bandNo * 37 + 1_000)}`,
        chickUnitPriceCentimes: String(chickPrice), dayOldWeightGrams: rng.int(39, 44),
        ...(open ? {} : { paidOnDelivery: { cashAccountId: a.cash, amountCentimes: String(chicks * chickPrice) } }),
      }, open ? undefined : { cash: -chicks * chickPrice });
      story.add(c.placedOn, RANK.place, "worker", "biosecurity.recordVisit", { id: id(), farmId: a.farm1, enteredAt: at(c.placedOn, "06:00"), visitor: "Livreur du couvoir", vehicle: `${rng.int(10_000, 99_999)}-B-${rng.int(1, 60)}`, purpose: "chickDelivery", recentFarm: false, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "dirty" });
      // The litter and the gas for the brooding, bought at the depot and used.
      const litterKg = area * 6;
      buy(story, rng, { item: a.litter1, unit: "kg", supplier: depot, farmId: a.farm1, day: addFarmDays(c.placedOn, -4), quantity: litterKg * 1000, unitPriceCentimes: 120, delivery: false });
      story.add(addFarmDays(c.placedOn, -2), RANK.close, "manager", "inventory.adjustStock", { id: id(), stockItemId: a.litter1, day: addFarmDays(c.placedOn, -2), quantity: -litterKg * 1000, reason: "Litière étalée dans le bâtiment avant l'arrivée des poussins" });
      const bottles = cold(c.placedOn) ? 46 : hot(c.placedOn) ? 12 : 28;
      buy(story, rng, { item: a.gas1, unit: "unit", supplier: depot, farmId: a.farm1, day: addFarmDays(c.placedOn, -1), quantity: bottles, unitPriceCentimes: 41_000 + rng.int(0, 2) * 500, delivery: false });
      story.add(addFarmDays(c.placedOn, -1), RANK.buy, "worker", "biosecurity.recordVisit", { id: id(), farmId: a.farm1, enteredAt: at(addFarmDays(c.placedOn, -1), "09:00"), visitor: "Livreur de gaz", vehicle: `${rng.int(10_000, 99_999)}-A-${rng.int(1, 60)}`, purpose: "gas", recentFarm: true, wheelsDisinfected: true, footbath: true, farmClothing: false, zone: "dirty" });
      story.add(addFarmDays(c.placedOn, 14), RANK.close, "manager", "inventory.adjustStock", { id: id(), stockItemId: a.gas1, day: addFarmDays(c.placedOn, 14), quantity: -bottles, reason: "Bouteilles vides : chauffage des poussins terminé" });

      const treated = open ? { start: 18, days: 5, withdrawal: 7 } : rng.chance(0.35) ? { start: rng.int(12, 20), days: 5, withdrawal: rng.int(5, 7) } : null;
      if (treated && !open && treated.start + treated.days + treated.withdrawal > lastSaleAge - 2) treated.start = lastSaleAge - 2 - treated.days - treated.withdrawal;
      grow(f1, {
        batchId, houseId: house, placedOn: c.placedOn, placed: chicks - doa, lastAge: c.lastAge, open,
        feed: (age) => (age <= 10 ? a.starter : age <= 24 ? a.grower : a.finisher),
        model: BROILER,
        perMille: (age, day) => (age <= 3 ? 2.6 : age <= 7 ? 1.2 : age <= 28 ? 0.45 : 0.65) + (hot(day) && age > 25 && rng.chance(0.18) ? 3 : 0) + (treated && age >= treated.start - 2 && age < treated.start + 3 ? 0.9 : 0),
        perf: rng.around(hot(c.placedOn) ? 0.95 : 1, 0.04),
        skip: open ? [15] : [],
        sales: salePlans, pricePerKg: price.broiler, weighEvery: 7, sample: 50,
        catching: (birds) => birds * 25,
      });
      vaccinate(f1, batchId, c.placedOn, a.broilerPlan, broilerProgramme, chicks - doa - Math.round(chicks * 0.01), 0, open ? today : addFarmDays(c.placedOn, c.lastAge));
      if (treated) treat(f1, batchId, c.placedOn, treated.start, treated.days, treated.withdrawal, Math.round((chicks / 1000) * 110 * treated.days), rng.pick(["Râles respiratoires", "Entérite, fientes liquides", "Boiteries et retard de croissance"]), `ORD ${c.placedOn.slice(2, 4)}/${String(rng.int(100, 999))}`);
      rounds(f1, batchId, c.placedOn, [2, 16, 30].filter((x) => x <= c.lastAge), () => rng.pick(VET_NOTES));
      if (!open) cleanout(f1, house, batchId, addFarmDays(c.placedOn, c.lastAge), next, Math.round(area * 14 * rng.around(1, 0.1)), isLatestB2 ? 3 : 7);
      if (isLatestB2) current.b2 = batchId;
    });
  }
  // House 2's next placement, planned twelve days from now; the open batch's budget.
  story.add(T(3), RANK.late, "manager", "planning.savePlan", { id: id(), houseId: a.b2, placeOn: addFarmDays(today, 12), chicks: 7_600, strainId: "ross-308", hatchery: "Couvoir Al Mostakbal, Berrechid", chickPriceCentimes: String(price.chick(today)), saleAge: 42 });
  const b1PlacedOn = T(24);
  story.call(b1PlacedOn, "budget", () => saveBudget(owner, { id: id(), name: `Bande du bâtiment 1, ${b1PlacedOn.slice(8, 10)}/${b1PlacedOn.slice(5, 7)}/${b1PlacedOn.slice(0, 4)}`, basedOn: null, batchId: current.b1, chicks: "9600", chickPriceCentimes: String(price.chick(b1PlacedOn)), feedGrams: "41500000", feedPricePerKgCentimes: "556", otherCostCentimes: "2400000", plannedGrams: "23200000", salePricePerKgCentimes: "1500", saleDay: "42" }));

  // ── Laying hens: point-of-lay pullets bought for the first flock; the second reared at Aïn Sbit, transferred at 17 weeks. ──
  const L1 = { id: id(), placedOn: F(9), hens: 5_600, reformOn: F(394) };
  const P1 = { id: id(), placedOn: F(302) };
  const transferOn = addFarmDays(P1.placedOn, 119);
  const L2 = id();
  const layerGrams = curve([[119, 1_450], [161, 1_790], [210, 1_890], [350, 1_960], [520, 2_040]]);
  story.add(L1.placedOn, RANK.place, "manager", "flock.placeBatch", { id: L1.id, houseId: a.layerHouse, species: "layer", strainId: "lohmann-brown", placedOn: L1.placedOn, chicksPlaced: L1.hens, deadOnArrival: 0, hatchery: "Élevage de poulettes Ouled Abbou", deliveryNote: `BL ${L1.placedOn.slice(2, 4)}-0042`, chickUnitPriceCentimes: "5600", dayOldWeightGrams: null, ageAtPlacementDays: 119 });
  for (const [n, dh] of [[10, 100_000], [40, 100_000], [72, 113_600]] as const)
    story.call(addFarmDays(L1.placedOn, n), "hens payment", () => payPlacement(owner, { id: id(), batchId: L1.id, day: addFarmDays(L1.placedOn, n), amountCentimes: String(dh * 100), paidWith: "transfer", treasuryId: a.bank }), { bank: -dh * 100 });
  const lay = (batchId: string, firstDay: FarmDay, firstAge: number, hens: number, lastDay: FarmDay, open: boolean) => {
    const eggStock = { ungraded: 0, downgraded: 0 };
    let alive = hens;
    for (let day = firstDay; day <= lastDay && day <= today; day = addFarmDays(day, 1)) {
      const age = firstAge + daysBetween(firstDay, day);
      const dead = Math.round(alive * (0.22 + (hot(day) && rng.chance(0.15) ? 1.2 : 0)) / 1000 * rng.around(1, 0.7));
      alive -= dead;
      const grams = Math.round(alive * LAYER.intake(age) * rng.around(1, 0.02));
      if (day === today && open) break; // today's day and collection are the presenter's to type
      need(needs, a.layerFeed, day, grams);
      story.add(day, RANK.day, "worker", "flock.recordDay", { batchId, day, changes: { dead, deathCause: dead ? (hot(day) ? "heat" : "unknown") : null, culled: 0, feed: { stockItemId: a.layerFeed, grams }, waterMl: Math.round(grams * (hot(day) ? 2.3 : 1.9)), note: null } });
      const laid = Math.round(alive * LAYER.lay(age) * rng.around(1, 0.015));
      const pct = (p: number) => Math.round(laid * p * rng.around(1, 0.3));
      const counts = { cracked: pct(0.012), dirty: pct(0.015), doubleYolk: pct(age < 180 ? 0.012 : 0.003), floor: pct(0.004), broken: pct(0.003), normal: 0 };
      counts.normal = laid - counts.cracked - counts.dirty - counts.doubleYolk - counts.floor - counts.broken;
      if (laid > 0) {
        story.add(day, RANK.eggs, "worker", "eggs.recordCollection", { id: id(), batchId, day, counts, sample: { count: 30, grams: Math.round(30 * LAYER.eggGrams(age) * rng.around(1, 0.01)) } });
        eggStock.ungraded += counts.normal + counts.doubleYolk;
        eggStock.downgraded += counts.cracked + counts.dirty + counts.floor;
      }
      if (daysBetween(firstDay, day) % 28 === 14) {
        const avg = Math.round(layerGrams(age) * rng.around(1, 0.02));
        story.add(day, RANK.day, "worker", "flock.recordWeighing", { id: id(), batchId, day, sample: { totalGrams: avg * 30, count: 30 } });
      }
      // Sales: the wholesaler on Tuesdays and Fridays (on account, settled on Mondays), the grocer on Saturdays in
      // cash, the souk on Mondays for the downgraded eggs; Thursday, Wednesday's eggs graded and sold to the grocer.
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
      const tray = (n: number) => Math.floor(n / 30) * 30;
      const eggSale = (buyerId: string, lines: { item: string; eggs: number; unitPriceCentimes: number }[], method: "cash" | "credit") => {
        const lineTotal = (l: { eggs: number; unitPriceCentimes: number }) => Math.floor((l.eggs * l.unitPriceCentimes * 2 + 30) / 60);
        const total = lines.reduce((s, l) => s + lineTotal(l), 0);
        if (lines.every((l) => l.eggs > 0))
          story.add(day, RANK.sale, "manager", "sales.recordEggSale", { id: id(), batchId, buyerId, day, lines: lines.map((l) => ({ ...l, eggsPerTray: 30, unitPriceCentimes: String(l.unitPriceCentimes) })), paymentMethod: method, paidCentimes: method === "cash" ? String(total) : "0", instrument: null }, method === "cash" ? { cash: total } : undefined);
        return total;
      };
      const trayPrice = Math.round(price.egg(day) * 30 / 10) * 10;
      const last = day >= addFarmDays(lastDay, -1) && !open;
      if (weekday === 4 && !last) {
        const yesterday = laidYesterday.get(addFarmDays(day, -1)) ?? 0;
        const total = Math.floor(yesterday * 0.9 / 30) * 30;
        if (total > 300) {
          const grades = { s: Math.round(total * 0.08), m: Math.round(total * 0.42), l: Math.round(total * 0.4), xl: 0 };
          grades.xl = total - grades.s - grades.m - grades.l;
          story.add(day, RANK.eggs, "worker", "eggs.gradeEggs", { id: id(), batchId, laidOn: addFarmDays(day, -1), grades });
          eggStock.ungraded -= total;
          eggSale(a.grocer, (["s", "m", "l", "xl"] as const).filter((g) => grades[g] > 0).map((g) => ({ item: `grade:${g}`, eggs: grades[g], unitPriceCentimes: trayPrice + { s: -300, m: 150, l: 450, xl: 750 }[g] })), "cash");
        }
      }
      laidYesterday.set(day, counts.normal + counts.doubleYolk);
      if (weekday === 2 || weekday === 5 || last) {
        const eggs = tray(eggStock.ungraded * 0.94);
        if (eggs > 0) {
          const total = eggSale(a.eggTrader, [{ item: "ungraded", eggs, unitPriceCentimes: trayPrice }], "credit");
          eggStock.ungraded -= eggs;
          credits.push({ buyerId: a.eggTrader, day: addFarmDays(day, weekday === 2 ? 6 : 3), amount: total, method: "transfer" });
        }
      }
      if (weekday === 6 && !last) {
        const eggs = Math.min(tray(eggStock.ungraded * 0.5), 1_800);
        if (eggs > 0) {
          eggStock.ungraded -= eggs;
          eggSale(a.grocer, [{ item: "ungraded", eggs, unitPriceCentimes: trayPrice + 150 }], "cash");
        }
      }
      if (weekday === 1 || last) {
        const eggs = tray(eggStock.downgraded * 0.97);
        if (eggs > 0) {
          eggStock.downgraded -= eggs;
          eggSale(a.souk, [{ item: "downgraded", eggs, unitPriceCentimes: Math.round(trayPrice * 0.68 / 10) * 10 }], "cash");
        }
      }
    }
    return alive;
  };
  const laidYesterday = new Map<FarmDay, number>();
  const credits: Credit[] = [];
  vaccinate(f1, L1.id, L1.placedOn, a.layerPlan, layerProgramme, L1.hens - 150, 119, addFarmDays(L1.reformOn, -1));
  rounds(f1, L1.id, L1.placedOn, Array.from({ length: 13 }, (_, k) => 3 + k * 30).filter((x) => addFarmDays(L1.placedOn, x) < L1.reformOn), () => rng.pick(VET_NOTES));
  const reformed = lay(L1.id, L1.placedOn, 119, L1.hens, L1.reformOn, false);
  if (L1.reformOn <= today) {
    const total = reformed * price.cullHen(L1.reformOn);
    story.add(L1.reformOn, RANK.sale, "manager", "sales.recordHeadSale", { id: id(), batchId: L1.id, buyerId: a.reform, day: L1.reformOn, lines: [{ item: "hen", birds: reformed, pricePerHeadCentimes: String(price.cullHen(L1.reformOn)) }], farmWeightGrams: reformed * 1_950, paymentMethod: "cash", paidCentimes: String(total), instrument: null }, { cash: total });
    cleanout(f1, a.layerHouse, L1.id, L1.reformOn, transferOn, 26_000);
  }
  // The pullets of the second flock, then the hens in the laying house.
  const pulletsPlaced = 5_900;
  story.add(P1.placedOn, RANK.place, "manager", "flock.placeBatch", { id: P1.id, houseId: a.pulletHouse, species: "pullet", strainId: "lohmann-brown", placedOn: P1.placedOn, chicksPlaced: pulletsPlaced, deadOnArrival: 9, hatchery: "Couvoir Sidi Rahal", deliveryNote: `BL ${P1.placedOn.slice(2, 4)}-0311`, chickUnitPriceCentimes: "1050", dayOldWeightGrams: 37, paidOnDelivery: { cashAccountId: a.cash, amountCentimes: String(pulletsPlaced * 1050) } }, { cash: -pulletsPlaced * 1050 });
  const pulletsLeft = grow(f2, {
    batchId: P1.id, houseId: a.pulletHouse, placedOn: P1.placedOn, placed: pulletsPlaced - 9, lastAge: Math.min(119, daysBetween(P1.placedOn, today) - (transferOn > today ? 1 : 0)), open: true,
    feed: () => a.pulletFeed, model: PULLET, perMille: (age) => (age <= 7 ? 1.4 : 0.12), perf: 1, sales: [{ age: 999, share: 1, buyerId: a.reform, method: "cash" }], weighEvery: 14, sample: 30,
  });
  vaccinate(f2, P1.id, P1.placedOn, a.pulletPlan, pulletProgramme, pulletsPlaced - 60, 0, addFarmDays(transferOn, -1));
  rounds(f2, P1.id, P1.placedOn, [7, 35, 63, 91, 112], () => rng.pick(VET_NOTES));
  if (transferOn <= today) {
    const hens = Math.floor(pulletsLeft / 10) * 10 - 20;
    story.add(transferOn, RANK.sale, "manager", "flock.transferToLaying", { batchId: P1.id, day: transferOn, newBatchId: L2, houseId: a.layerHouse, hens });
    cleanout(f2, a.pulletHouse, P1.id, transferOn, null, 9_000);
    vaccinate(f1, L2, transferOn, a.layerPlan, layerProgramme, hens - 100, 119, today, RANK.sale);
    rounds(f1, L2, transferOn, Array.from({ length: 12 }, (_, k) => 5 + k * 30), () => rng.pick(VET_NOTES));
    // The hens' days start the day after the transfer (the transfer day is the pullets' last).
    lay(L2, addFarmDays(transferOn, 1), 120, hens, today, true);
  }
  // The next pullets, two months old today.
  const P2 = id();
  if (T(60) > addFarmDays(transferOn, 25)) {
    story.add(T(60), RANK.place, "manager", "flock.placeBatch", { id: P2, houseId: a.pulletHouse, species: "pullet", strainId: "lohmann-brown", placedOn: T(60), chicksPlaced: 5_800, deadOnArrival: 7, hatchery: "Couvoir Sidi Rahal", deliveryNote: `BL ${T(60).slice(2, 4)}-0388`, chickUnitPriceCentimes: "1100", dayOldWeightGrams: 37, paidOnDelivery: { cashAccountId: a.cash, amountCentimes: String(5_800 * 1100) } }, { cash: -5_800 * 1100 });
    grow(f2, { batchId: P2, houseId: a.pulletHouse, placedOn: T(60), placed: 5_793, lastAge: 59, open: true, feed: () => a.pulletFeed, model: PULLET, perMille: (age) => (age <= 7 ? 1.4 : 0.12), perf: 1, sales: [{ age: 999, share: 1, buyerId: a.reform, method: "cash" }], weighEvery: 14, sample: 30 });
    vaccinate(f2, P2, T(60), a.pulletPlan, pulletProgramme, 5_700);
    rounds(f2, P2, T(60), [7, 35], () => rng.pick(VET_NOTES));
  }

  // ── Turkeys (BUT 6) in the open house and beldi chickens on the run, at Aïn Sbit. ──
  const turkeyCycles = backFrom({ placedOn: T(50), lastAge: 50, open: true }, [30, 40], [112, 124]);
  for (const c of turkeyCycles) {
    const batchId = id();
    const poults = rng.int(28, 32) * 100;
    const poultPrice = 1_750 + rng.int(0, 5) * 50;
    const poultsDead = rng.int(3, 9);
    story.add(c.placedOn, RANK.place, "manager", "flock.placeBatch", { id: batchId, houseId: a.turkeyHouse, species: "turkey", strainId: "but-6", placedOn: c.placedOn, chicksPlaced: poults, deadOnArrival: poultsDead, hatchery: "Couvoir de dindonneaux du Gharb, Sidi Slimane", deliveryNote: `BL ${c.placedOn.slice(2, 4)}-0${rng.int(500, 899)}`, chickUnitPriceCentimes: String(poultPrice), dayOldWeightGrams: 58, paidOnDelivery: { cashAccountId: a.cash, amountCentimes: String(poults * poultPrice) } }, { cash: -poults * poultPrice });
    buy(story, rng, { item: a.litter2, unit: "kg", supplier: depot, farmId: a.farm2, day: addFarmDays(c.placedOn, -3), quantity: 4_500_000, unitPriceCentimes: 150, delivery: false });
    story.add(addFarmDays(c.placedOn, -2), RANK.close, "manager", "inventory.adjustStock", { id: id(), stockItemId: a.litter2, day: addFarmDays(c.placedOn, -2), quantity: -4_500_000, reason: "Litière de copeaux étalée avant l'arrivée des dindonneaux" });
    grow(f2, {
      batchId, houseId: a.turkeyHouse, placedOn: c.placedOn, placed: poults - poultsDead, lastAge: c.lastAge, open: c.open,
      feed: (age) => (age <= 35 ? a.turkeyStart : a.turkeyGrow), model: TURKEY,
      perMille: (age, day) => (age <= 14 ? 2.2 : 0.35) + (hot(day) && age > 60 && rng.chance(0.1) ? 2 : 0), perf: rng.around(1, 0.04),
      sales: [{ age: (c.open ? 118 : c.lastAge) - 1, share: rng.around(0.6, 0.1), buyerId: a.turkeyAbattoir, method: "transfer" }, { age: c.open ? 118 : c.lastAge, share: 1, buyerId: a.marchand, method: rng.pick(["cash", "credit"] as const) }],
      pricePerKg: price.turkey, weighEvery: 14, sample: 20, catching: (birds) => birds * 60,
    });
    vaccinate(f2, batchId, c.placedOn, a.turkeyPlan, turkeyProgramme, poults - 150, 0, c.open ? today : addFarmDays(c.placedOn, c.lastAge));
    rounds(f2, batchId, c.placedOn, [3, 30, 60, 90, 115].filter((x) => x <= c.lastAge), () => rng.pick(VET_NOTES));
    if (!c.open) cleanout(f2, a.turkeyHouse, batchId, addFarmDays(c.placedOn, c.lastAge), turkeyCycles[turkeyCycles.indexOf(c) + 1]?.placedOn ?? null, 38_000);
  }
  const beldiCycles = backFrom({ placedOn: T(80), lastAge: 80, open: true }, [25, 35], [100, 112]);
  for (const c of beldiCycles) {
    const batchId = id();
    const chicks = 2_000;
    const chicksDead = rng.int(2, 6);
    const chickPrice = 400 + rng.int(0, 4) * 20;
    story.add(c.placedOn, RANK.place, "manager", "flock.placeBatch", { id: batchId, houseId: a.beldiRun, species: "beldi", strainId: "unspecified-beldi", placedOn: c.placedOn, chicksPlaced: chicks, deadOnArrival: chicksDead, hatchery: "Couvoir beldi Zemmour, Khémisset", deliveryNote: `BL ${c.placedOn.slice(2, 4)}-0${rng.int(100, 499)}`, chickUnitPriceCentimes: String(chickPrice), dayOldWeightGrams: 35, paidOnDelivery: { cashAccountId: a.cash, amountCentimes: String(chicks * chickPrice) } }, { cash: -chicks * chickPrice });
    grow(f2, {
      batchId, houseId: a.beldiRun, placedOn: c.placedOn, placed: chicks - chicksDead, lastAge: c.lastAge, open: c.open,
      feed: () => a.beldiFeed, model: BELDI, perMille: (age) => (age <= 10 ? 1.6 : 0.3), perf: rng.around(1, 0.04),
      sales: [{ age: (c.open ? 106 : c.lastAge) - 6, share: 0.45, buyerId: a.soukTiflet, method: "cash" }, { age: c.open ? 106 : c.lastAge, share: 1, buyerId: a.restaurant, method: rng.pick(["transfer", "credit"] as const) }],
      headSale: (day, birds) => {
        const roosters = Math.round(birds * 0.48);
        return [{ item: "rooster", birds: roosters, pricePerHeadCentimes: String(7_500 + rng.int(0, 6) * 250) }, { item: "hen", birds: birds - roosters, pricePerHeadCentimes: String(5_800 + rng.int(0, 6) * 250) }];
      },
      weighEvery: 15, sample: 20,
    });
    vaccinate(f2, batchId, c.placedOn, a.beldiPlan, beldiProgramme, chicks - 60, 0, c.open ? today : addFarmDays(c.placedOn, c.lastAge));
    rounds(f2, batchId, c.placedOn, [5, 35, 65, 95].filter((x) => x <= c.lastAge), () => rng.pick(VET_NOTES));
    if (!c.open) cleanout(f2, a.beldiRun, batchId, addFarmDays(c.placedOn, c.lastAge), beldiCycles[beldiCycles.indexOf(c) + 1]?.placedOn ?? null, 9_500);
  }

  // ── Receivables: cheques and bills remitted and cashed, credit collected; one cheque came back unpaid. ──
  receivables(story, rng, sales, credits, { bounce: (sale) => sale.buyerId === a.marchand && sale.day > "2025-08-01" });
  story.add(T(30), RANK.late, "owner", "sales.setCreditLimit", { buyerId: a.chevillard, limitCentimes: "3000000" });
  story.add(T(30), RANK.late, "owner", "sales.setCreditLimit", { buyerId: a.eggTrader, limitCentimes: "4000000" });

  // ── Feed, vaccines and medicine, bought ahead of need; the grower left is under its threshold today. ──
  const feedFrom = (key: string, phase: Parameters<typeof price.feed>[1], farmId: string, lastOrder?: FarmDay) =>
    supply(story, rng, needs, { item: key, unit: "kg", supplier: feedCo, farmId, price: (d) => price.feed(d, phase), step: 1_000_000, cover: 4, ahead: 14, lastOrder });
  feedFrom(a.starter, "starter", a.farm1);
  feedFrom(a.grower, "grower", a.farm1, T(14));
  feedFrom(a.finisher, "finisher", a.farm1);
  feedFrom(a.layerFeed, "layer", a.farm1);
  feedFrom(a.pulletFeed, "pullet", a.farm2);
  feedFrom(a.turkeyStart, "turkeyStart", a.farm2);
  feedFrom(a.turkeyGrow, "turkeyGrow", a.farm2);
  feedFrom(a.beldiFeed, "beldi", a.farm2);
  story.add(T(14), RANK.late, "manager", "inventory.setThreshold", { stockItemId: a.grower, lowStockThreshold: 2_000_000 });
  story.add(T(14), RANK.late, "manager", "inventory.setThreshold", { stockItemId: a.layerFeed, lowStockThreshold: 3_000_000 });
  const dosePrice: Record<string, number> = { "vaccine-newcastle": 12, "vaccine-infectious-bronchitis": 14, "vaccine-gumboro": 17, "vaccine-avian-influenza-h9n2": 85 };
  for (const [lot, meta] of lotMeta) {
    const firstNeed = [...needs.get(lot)!.keys()].sort()[0];
    const created = addFarmDays(firstNeed, -2) < from ? from : addFarmDays(firstNeed, -2);
    item(lot, meta.farmId, "vaccine", meta.name, "dose", meta.productId, meta.lot, addFarmDays(firstNeed, 270), created);
    const bought = supply(story, rng, needs, { item: lot, unit: "dose", supplier: vetCo, farmId: meta.farmId, price: () => dosePrice[meta.productId], step: 1_000, cover: 120, ahead: 120 });
    // The quarter's lot used up: what is left of the opened vials is destroyed, never kept past its season.
    const leftOn = bought && addFarmDays(bought.lastDay, 1);
    if (bought && bought.left > 0 && leftOn! < addFarmDays(today, -30))
      story.add(leftOn!, RANK.late, "manager", "inventory.adjustStock", { id: id(), stockItemId: lot, day: leftOn, quantity: -bought.left, reason: "Fin du lot : doses restantes des flacons entamés détruites" });
  }
  for (const [med, farmId] of [[a.medicine, a.farm1], [a.medicine2, a.farm2]]) supply(story, rng, needs, { item: med, unit: "ml", supplier: vetCo, farmId, price: () => 32, step: 5_000, cover: 30, ahead: 120 });
  payStatements(story, rng, [feedCo], units, instrument);

  // ── Monthly bills, the vet's retainer, the bank's fees, insurance; market prices; climate; the team. ──
  for (let m = from; m <= today; m = addFarmDays(`${m.slice(0, 7)}-01` as FarmDay, 32)) {
    const month = m.slice(0, 7);
    const day = (d: number) => `${month}-${String(d).padStart(2, "0")}` as FarmDay;
    const monthName = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
    for (const [farmId, base] of [[a.farm1, 4_600_00], [a.farm2, 1_900_00]] as const) {
      const bill = seasonal(rng, day(8), base);
      story.add(day(8), RANK.money, "manager", "finance.recordExpense", { id: id(), day: day(8), category: "electricity", amountCentimes: String(bill), paidFrom: "bank", treasuryId: a.bank, note: `Facture ONEE, ${monthName}${farmId === a.farm2 ? ", Aïn Sbit" : ""}` }, { bank: -bill });
    }
    const retainer = 150_000;
    story.add(day(28), RANK.money, "owner", "finance.recordExpense", { id: id(), day: day(28), category: "vet_fees", amountCentimes: String(retainer), paidFrom: "bank", treasuryId: a.bank, note: `Suivi sanitaire mensuel, Dr Berrada, ${monthName}` }, { bank: -retainer });
    const fees = 4_500 + rng.int(0, 3) * 500;
    story.add(day(28), RANK.money, "owner", "finance.recordExpense", { id: id(), day: day(28), category: "bank_fees", amountCentimes: String(fees), paidFrom: "bank", treasuryId: a.bank, note: "Frais de tenue de compte et commissions" }, { bank: -fees });
    if (Number(month.slice(5)) % 3 === 0) {
      const water = seasonal(rng, day(15), 82_000);
      story.add(day(15), RANK.money, "manager", "finance.recordExpense", { id: id(), day: day(15), category: "water", amountCentimes: String(water), paidFrom: "cash", treasuryId: a.cash, note: "Facture d'eau du trimestre" }, { cash: -water });
    }
    if (month.endsWith("-01")) {
      const premium = 1_180_000 + rng.int(0, 4) * 10_000;
      story.add(day(15), RANK.money, "owner", "finance.recordExpense", { id: id(), day: day(15), category: "insurance", amountCentimes: String(premium), paidFrom: "bank", treasuryId: a.bank, note: `Assurance multirisque des bâtiments et du cheptel, ${month.slice(0, 4)}` }, { bank: -premium });
    }
    for (const [farmId, house] of [[a.farm1, a.b1], [a.farm2, a.turkeyHouse]] as const) {
      story.add(day(5), RANK.close, farmId === a.farm1 ? "worker" : "manager", "biosecurity.recordRodentCheck", { id: id(), farmId, houseId: house, day: day(5), action: "baitPlaced", product: "Appât raticide en blocs (bromadiolone)" });
      story.add(day(19), RANK.close, farmId === a.farm1 ? "worker" : "manager", "biosecurity.recordRodentCheck", { id: id(), farmId, houseId: house, day: day(19), action: "baitChecked", product: null });
    }
    story.add(day(12), RANK.care, "worker", "biosecurity.recordVisit", { id: id(), farmId: a.farm1, enteredAt: at(day(12), "10:30"), visitor: "Technicien de la provenderie", vehicle: `${rng.int(10_000, 99_999)}-D-${rng.int(1, 60)}`, purpose: "technician", recentFarm: true, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "dirty" });
  }
  for (let w = 0; addFarmDays(from, 7 * w + 6) <= today; w++) {
    const monday = addFarmDays(from, 7 * w + 5);
    const p: [string, number, string][] = [["liveBroiler", price.broiler(monday), "Souk de Ben Ahmed"], ["egg", price.egg(monday), "Grossiste en œufs, Derb Omar"]];
    if (w % 2 === 0) p.push(["chick", price.chick(monday), "Couvoir Al Mostakbal"], ["feed", price.feed(monday, "finisher"), "Provenderie Oum Errabia"], ["cullHen", price.cullHen(monday), "Marchand de poules de réforme"]);
    for (const [product, c, seenOn] of p) story.add(monday, RANK.late, "manager", "market-prices.recordPrice", { id: id(), product, day: monday, priceCentimes: String(c), seenOn });
  }
  // Brooding readings in house 1, twice a day for its first two weeks; the open batch's last week three times a day.
  for (const { cycles } of broilers.slice(0, 1))
    for (const c of cycles)
      for (let age = 0; age <= Math.min(14, c.lastAge); age++) {
        const day = addFarmDays(c.placedOn, age);
        const target = age <= 7 ? 320 : 270;
        for (const [time, delta] of [["08:00", -8], ["15:00", hot(day) ? 10 : 6]] as const)
          story.add(day, RANK.day, "worker", "climate.recordReading", { id: id(), houseId: a.b1, day, time, temperatureTenths: target + delta + rng.int(-6, 6), humidity: rng.int(56, 68), ammonia: rng.int(6, 12) });
      }
  for (let n = 7; n >= 1; n--)
    for (const [time, t] of [["08:00", 250], ["14:00", 266], ["20:00", 256]] as const)
      story.add(T(n), RANK.day, "worker", "climate.recordReading", { id: id(), houseId: a.b1, day: T(n), time, temperatureTenths: t + rng.int(-6, 6) + (n === 1 && time === "14:00" ? 24 : 0), humidity: rng.int(55, 68), ammonia: rng.int(8, 16) });
  for (const [day, start, minutes] of [["2025-01-27", "18:40", 155], ["2025-07-18", "14:10", 95], ["2025-12-12", "06:20", 210], ["2026-03-04", "21:05", 75], ["2026-08-09", "13:30", 140], [T(4), "10:05", 150]] as const) {
    const cut = id();
    const d = day as FarmDay;
    story.add(d, RANK.day, "worker", "climate.startPowerCut", { id: cut, farmId: a.farm1, startedAt: at(d, start) });
    story.add(d, RANK.day, "worker", "climate.endPowerCut", { id: cut, endedAt: new Date(Date.parse(at(d, start)) + minutes * 60_000).toISOString(), generatorStarted: true, generatorSeconds: (minutes - 3) * 60, dieselMl: Math.round(minutes * 120) * 10 });
  }

  // The team: two members who sign in (the manager and the worker), the guard, the two of Aïn Sbit.
  const staffList: Employee[] = [
    { id: a.hamid, farmId: a.farm1, name: "Hamid Ouazzani", job: "lead", phone: staff.manager, housed: true, startedOn: from, wage: 16_000, rest: 0, houseIds: [a.b1, a.b2, a.layerHouse], cnss: "121 458 903" },
    { id: a.brahim, farmId: a.farm1, name: "Brahim Aït Lahcen", job: "worker", phone: staff.worker, housed: false, startedOn: from, wage: 12_000, rest: 5, houseIds: [a.b1, a.b2, a.layerHouse], cnss: "134 902 617" },
    { id: a.mustapha, farmId: a.farm1, name: "Mustapha El Idrissi", job: "guard", phone: null, housed: true, startedOn: from, wage: 10_000, rest: 3, houseIds: [], cnss: null },
    { id: a.fatima, farmId: a.farm2, name: "Fatima Zahra Amrani", job: "worker", phone: null, housed: false, startedOn: F(20), wage: 11_500, rest: 5, houseIds: [a.pulletHouse, a.turkeyHouse, a.beldiRun], cnss: "140 377 285" },
    { id: a.abdellah, farmId: a.farm2, name: "Abdellah Chraibi", job: "worker", phone: null, housed: true, startedOn: F(150), wage: 11_000, rest: 0, houseIds: [a.turkeyHouse, a.beldiRun], cnss: null },
  ];
  team(story, rng, staffList, {
    payFrom: (farmId) => (farmId === a.farm1 ? "cash" : "bank"),
    advances: [["2025-06-02", a.brahim, 1_000], ["2025-06-02", a.fatima, 800], ["2025-06-03", a.mustapha, 600], ["2025-09-02", a.brahim, 800], ["2025-09-04", a.abdellah, 500], ["2026-05-21", a.brahim, 1_000], ["2026-05-21", a.fatima, 800], ["2026-05-22", a.abdellah, 600], ["2026-09-03", a.brahim, 800], [T(5), a.brahim, 500]],
  });
  for (const [day, employeeId, record] of [
    [F(42), a.brahim, { kind: "training", topic: "biosecurity", note: "Pédiluve, tenue de travail, sens de circulation entre bâtiments" }],
    [F(42), a.mustapha, { kind: "training", topic: "biosecurity", note: "Registre des visiteurs et désinfection des roues" }],
    [F(97), a.fatima, { kind: "training", topic: "vaccination", note: "Vaccination à l'eau de boisson : préparation, lait écrémé, durée" }],
    ["2025-10-14", a.brahim, { kind: "accident", note: "Coupure à la main en réparant une mangeoire", daysOff: 3 }],
    ["2026-01-20", a.abdellah, { kind: "training", topic: "biosecurity", note: "Nettoyage et désinfection du bâtiment dindes" }],
  ] as const) story.add(day as FarmDay, RANK.staff, "manager", "workforce.addStaffRecord", { id: id(), employeeId, day, ...record });
  const routines = [
    { id: id(), farmId: a.farm1, houseId: null, employeeId: a.brahim, title: "Contrôler les abreuvoirs et les pipettes", time: "07:30", everyDays: 1 },
    { id: id(), farmId: a.farm1, houseId: a.layerHouse, employeeId: a.brahim, title: "Ramasser les œufs (2ᵉ passage)", time: "14:00", everyDays: 1 },
    { id: id(), farmId: a.farm1, houseId: null, employeeId: a.hamid, title: "Relever les températures des bâtiments", time: "08:00", everyDays: 1 },
    { id: id(), farmId: a.farm1, houseId: null, employeeId: a.mustapha, title: "Renouveler l'eau du pédiluve", time: "07:00", everyDays: 2 },
    { id: id(), farmId: a.farm2, houseId: a.turkeyHouse, employeeId: a.fatima, title: "Rabattre les rideaux le soir", time: "18:30", everyDays: 1 },
  ];
  for (const r of routines) story.add(F(3), RANK.staff, "manager", "workforce.saveRoutine", { ...r, startOn: F(3), fromAge: null, stopOn: null });
  for (let n = 6; n >= 1; n--) // ticks reach back a week at most (OFFLINE_DAYS)
    for (const r of routines.filter((x) => x.everyDays === 1 && x.farmId === a.farm1)) {
      const key = `routine:${r.id}`;
      story.add(T(n), RANK.late, "worker", "workforce.tickTask", { id: taskDoneId(key, T(n)), farmId: r.farmId, key, day: T(n) });
    }
  const done = id();
  story.add(T(1), RANK.staff, "manager", "workforce.addTask", { id: done, farmId: a.farm1, houseId: a.b2, employeeId: a.brahim, day: T(1), title: "Évacuer le fumier du bâtiment 2", time: "09:00" });
  story.add(T(1), RANK.late, "worker", "workforce.tickTask", { id: taskDoneId(`oneoff:${done}`, T(1)), farmId: a.farm1, key: `oneoff:${done}`, day: T(1) });
  story.add(today, RANK.staff, "manager", "workforce.addTask", { id: id(), farmId: a.farm1, houseId: a.b2, employeeId: a.hamid, day: today, title: "Désinfecter le bâtiment 2", time: "08:00" });
  story.add(today, RANK.staff, "manager", "workforce.addTask", { id: id(), farmId: a.farm2, houseId: null, employeeId: a.fatima, day: today, title: "Recevoir la livraison d'aliment poulette", time: "10:00" });
  story.add(today, RANK.staff, "manager", "workforce.assignTask", { id: taskAssignmentId(owner.organizationId, `routine:${routines[0].id}`, today), farmId: a.farm1, key: `routine:${routines[0].id}`, day: today, employeeId: a.hamid });
  story.add(today, RANK.care, "worker", "biosecurity.recordVisit", { id: id(), farmId: a.farm1, enteredAt: new Date(Math.max(Date.parse(`${today}T00:30:00Z`), Date.now() - 30 * 60_000)).toISOString(), visitor: "Technicien de la provenderie", vehicle: "48213-D-7", purpose: "technician", recentFarm: true, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "dirty" });

  // ── Papers with due dates. ──
  const docs: [string, string, string, string, string | null, string | null][] = [
    ["Agrément sanitaire ONSSA, Ferme Ennakhil", "authorization", a.farm1, "2023-05-15", addFarmDays(today, 25), "N° AS 11.23.0417 : renouvellement à déposer"],
    ["Agrément sanitaire ONSSA, Ferme Aïn Sbit", "authorization", a.farm2, "2024-09-10", "2027-09-09", "N° AS 04.24.1182"],
    ["Contrat de suivi sanitaire, Dr Nadia Berrada", "vetContract", a.farm1, from, "2026-12-31", "Visite mensuelle et urgences, honoraires mensuels"],
    ["Assurance multirisque 2025", "insurance", a.farm1, "2025-01-15", "2026-01-14", "Bâtiments, matériel et cheptel"],
    ["Assurance multirisque 2026", "insurance", a.farm1, "2026-01-15", "2027-01-14", "Bâtiments, matériel et cheptel"],
    ["Analyse d'eau du forage, mars 2025", "labReport", a.farm1, "2025-03-18", null, "Potable : conforme"],
    ["Analyse d'eau du forage, septembre 2025", "labReport", a.farm1, "2025-09-16", null, "Potable : conforme"],
    ["Analyse d'eau du forage, mars 2026", "labReport", a.farm1, "2026-03-17", null, "Potable : conforme"],
    ["Analyse d'eau du forage, septembre 2026", "labReport", a.farm1, "2026-09-15", null, "Coliformes légèrement au-dessus : chloration renforcée"],
    ["Bail du terrain d'Aïn Sbit", "land", a.farm2, "2023-06-01", "2029-05-31", "Bail de six ans, loyer annuel payé en juin"],
    ["Contrôle du groupe électrogène", "equipment", a.farm1, "2025-11-30", addFarmDays(today, 3), "Visite annuelle du prestataire"],
  ];
  for (const [title, category, farmId, issuedOn, expiresOn, notes] of docs) story.add(issuedOn < from ? from : (issuedOn as FarmDay), RANK.late, "manager", "documents.createDocument", { id: id(), title, category, farmId, issuedOn, expiresOn, notes });

  // ── Online, by the owner: the first contribution, the equipment loan, the generator, the cooling and its subsidy. ──
  story.call(from, "contribution", () => recordAssociateMovement(owner, { id: id(), day: from, direction: "contribution", amountCentimes: "35000000", treasuryId: a.bank, associate: null }), { bank: 35_000_000 }, RANK.setup + 1);
  const loan = id();
  const loanOn = F(68);
  story.call(loanOn, "loan", async () => {
    const created = await createLoan(owner, { id: loan, lender: "Banque, crédit d'équipement agricole", treasuryId: a.bank, principalCentimes: "24000000", disbursedOn: loanOn, rate: 6_250, frequency: "monthly", installments: 60, deferral: 0, firstDueOn: addFarmDays(loanOn, 31) });
    return created.ok ? confirmLoan(owner, { loanId: loan }) : created;
  }, { bank: 24_000_000 });
  for (let n = 1; n <= 60; n++) {
    const due = monthsAfter(addFarmDays(loanOn, 31), n - 1);
    story.call(due, `installment ${n}`, () => payLoanInstallment(owner, { loanId: loan, number: n, day: due }), { bank: -466_800 });
  }
  const generator = id();
  const cooling = id();
  story.call(F(73), "generator", () => createFixedAsset(owner, { id: generator, label: "Groupe électrogène 60 kVA", category: "installation", farmId: a.farm1, houseId: null, acquiredOn: F(73), inServiceOn: F(74), amountCentimes: "9200000", lifeMonths: 120, paidWith: "transfer", treasuryId: a.bank }), { bank: -9_200_000 });
  story.call(F(131), "cooling", () => createFixedAsset(owner, { id: cooling, label: "Refroidissement par pad cooling, bâtiment 1", category: "equipment", farmId: a.farm1, houseId: a.b1, acquiredOn: F(131), inServiceOn: F(138), amountCentimes: "13800000", lifeMonths: 84, paidWith: "transfer", treasuryId: a.bank }), { bank: -13_800_000 });
  story.call(F(323), "subsidy", () => createSubsidy(owner, { id: id(), label: "Aide à l'équipement des élevages avicoles (30 %)", grantor: "Fonds de développement agricole", amountCentimes: "4140000", receivedOn: F(323), treasuryId: a.bank, assetIds: [cooling] }), { bank: 4_140_000 });
  story.call(T(10), "chicks payment", () => payPlacement(owner, { id: id(), batchId: current.b1, day: T(10), amountCentimes: "3000000", paidWith: "transfer", treasuryId: a.bank }), { bank: -3_000_000 });

  // The treasurer last: it reads every flow above.
  treasurer(story, {
    cash: a.cash, bank: a.bank, openingBank: 0, floorCash: 500_000, floorBank: 3_000_000, drawings: 4_000_000,
    contribute: (day, amount) => story.call(day, "contribution", () => recordAssociateMovement(owner, { id: id(), day, direction: "contribution", amountCentimes: String(amount), treasuryId: a.bank, associate: null }), undefined, RANK.late),
    withdraw: (day, amount) => story.call(day, "drawings", () => recordAssociateMovement(owner, { id: id(), day, direction: "withdrawal", amountCentimes: String(amount), treasuryId: a.bank, associate: null }), undefined, RANK.late),
  });

  const played = await play({ owner, manager: people.manager, worker: people.worker, vet: people.vet }, story, "farm");
  return { ...played, farms: { farm1: a.farm1, farm2: a.farm2 }, bank: a.bank };
}

/** The same day of the month, `n` months later (clamped to the month's end). */
export function monthsAfter(day: FarmDay, n: number): FarmDay {
  const [y, m, d] = day.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const last = new Date(Date.UTC(Math.floor(total / 12), (total % 12) + 1, 0)).getUTCDate();
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}` as FarmDay;
}
