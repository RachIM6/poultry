import { v7 as uuidv7 } from "uuid";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { createOrganization } from "@/modules/farm-registry";
import { postPending, recordAssociateMovement, saveBudget } from "@/modules/finance";
import { addOwner, inviteMember } from "@/modules/identity";
import { attendanceId, taskDoneId } from "@/modules/workforce/schema";

// `pnpm db:seed:demo` (T26): two demo organisations to show the app, owned by DEMO_PHONE (default +212600000099): an
// individual farm with the whole range (broilers, layers, stock, sales, money, team, compliance, climate) and a SARL
// (full books and statements). Run `pnpm db:seed` first (strains, catalogue, charts). Everything goes through the same
// sync mutations as a phone, so every rule and audit event applies. Idempotent: a second run finds the owner and stops.
// The figures are made up to look plausible: DEMO ONLY, never a reference (no breeder curve, no vaccine schedule, no
// SMAG or contribution rate, no climate target). The reference protocols have no lines yet, so no vaccination is seeded.

// The production image runs with NODE_ENV=production: a demo farm there is a mistake unless asked for explicitly.
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
  console.error("demo: refused with NODE_ENV=production; set ALLOW_DEMO_SEED=1 to seed the demo farm anyway");
  process.exit(1);
}

// ── Accounts. Kept here and minimal: password login (ADR-015) adds the demo owner's credentials to these lines. ──
const phone = process.env.DEMO_PHONE ?? "+212600000099";
const PHONES = { associate: "+212600000098", vet: "+212600000097", accountant: "+212600000096" }; // made up, never called
if (await db.user.findUnique({ where: { phoneNumber: phone } })) {
  console.log(`demo: ${phone} already exists, nothing to do`);
  process.exit(0);
}
const newUser = (phoneNumber: string, name: string) => db.user.create({ data: { phoneNumber, name, email: `${phoneNumber.slice(1)}@phone.invalid`, locale: "fr" } });
const user = await newUser(phone, "Démo");
const associate = await newUser(PHONES.associate, "Associé démo");
const farmOrg = await createOrganization(user.id, { name: "Ferme Démo Ben Ahmed", form: "individual", locale: "fr" });
const sarlOrg = await createOrganization(associate.id, { name: "SARL Démo Avicole", form: "company", locale: "fr" });
if (!farmOrg.ok || !sarlOrg.ok) throw new Error("demo: onboarding refused");
await db.$transaction((tx) => addOwner(tx, { organizationId: sarlOrg.value.organizationId, userId: user.id, locale: "fr" })); // switch-farm shows both
const A: TenantContext = farmOrg.value;
const B: TenantContext = { userId: user.id, organizationId: sarlOrg.value.organizationId, role: "owner" };
// ── End of accounts. ──

const today = farmDayOf(new Date());
const ago = (n: number): FarmDay => addFarmDays(today, -n);
const at = (day: string, time: string) => `${day}T${time}:00+01:00`; // farm clock (Africa/Casablanca, outside Ramadan)
const m = (type: string, payload: unknown) => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
const dh = (x: number) => String(Math.round(x * 100)); // DH → integer centimes
const saleCentimes = (grams: number, perKg: number) => (BigInt(grams) * BigInt(perKg) * 2n + 1000n) / 2000n; // sales' saleAmount, half up
const tonnes = (grams: number) => Math.ceil(grams / 1_000_000) * 1_000_000;

type Mutation = ReturnType<typeof m>;
type Feed = { starter: string; grower: string; finisher: string };

/** A broiler batch's daily entries from placement to `lastAge`; `sold` takes birds out after that day's entry. */
function raise(batchId: string, placedOn: FarmDay, alive: number, lastAge: number, feed: Feed, sold: Record<number, number> = {}) {
  const entries: Mutation[] = [];
  const used: Record<string, number> = {};
  const chicks = alive;
  for (let age = 0; age <= lastAge; age++) {
    const dead = Math.round((chicks * (age <= 3 ? 1.75 : age <= 7 ? 0.9 : age % 9 === 0 ? 1.1 : 0.4)) / 1000);
    const culled = age % 10 === 5 ? Math.round(chicks / 2000) : 0;
    alive -= dead + culled;
    const item = age <= 10 ? feed.starter : age <= 24 ? feed.grower : feed.finisher;
    const grams = alive * Math.round(10 + 4.6 * age); // made-up intake, not a breeder table
    used[item] = (used[item] ?? 0) + grams;
    const changes = { dead, deathCause: age % 9 === 0 ? "heat" : "unknown", culled, feed: { stockItemId: item, grams }, waterMl: Math.round(grams * 1.8), note: null };
    entries.push(m("flock.recordDay", { batchId, day: addFarmDays(placedOn, age), changes }));
    alive -= sold[age] ?? 0;
  }
  return { entries, alive, used };
}

const weighings = (batchId: string, placedOn: FarmDay, grams: [age: number, average: number][]) =>
  grams.map(([age, avg]) => m("flock.recordWeighing", { id: uuidv7(), batchId, day: addFarmDays(placedOn, age), sample: { totalGrams: avg * 50, count: 50 } }));

const place = (id: string, houseId: string, placedOn: FarmDay, chicksPlaced: number, deliveryNote: string, extra: object = {}) =>
  m("flock.placeBatch", { id, houseId, strainId: "ross-308", placedOn, chicksPlaced, deadOnArrival: Math.round(chicksPlaced * 0.0015), hatchery: "Couvoir Démo", deliveryNote, chickUnitPriceCentimes: "550", dayOldWeightGrams: 42, ...extra });

const purchase = (supplierId: string, stockItemId: string, day: FarmDay, quantity: number, unitPriceCentimes: string, paid: "all" | "none" | bigint, paidMethod = "transfer", dueOn: FarmDay | null = null) => {
  const total = (BigInt(quantity) * BigInt(unitPriceCentimes) * 2n + 1000n) / 2000n; // per kg or per ml / 1000
  const paidCentimes = paid === "all" ? total : paid === "none" ? 0n : paid;
  return m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId, stockItemId, day, quantity, unitPriceCentimes, paidCentimes: String(paidCentimes), paidMethod, dueOn });
};

const sale = (batchId: string, buyerId: string, day: FarmDay, birds: number, avgGrams: number, perKg: number, paymentMethod: string, paid: "all" | "none", instrument: { number: string; dueOn: FarmDay } | null = null) => {
  const farmWeightGrams = birds * avgGrams;
  const paidCentimes = paid === "all" ? String(saleCentimes(farmWeightGrams, perKg)) : "0";
  return m("sales.recordSale", { id: uuidv7(), batchId, buyerId, day, birds, farmWeightGrams, buyerWeightGrams: farmWeightGrams - birds * 15, pricePerKgCentimes: String(perKg), paymentMethod, paidCentimes, instrument });
};

async function apply(ctx: TenantContext, label: string, mutations: Mutation[]) {
  const { results } = await push(ctx, mutations, registry);
  const refused = results.filter((r) => r.status !== "applied");
  if (refused.length > 0 || results.length !== mutations.length) {
    const why = refused.map((r) => ({ ...r, type: mutations.find((x) => x.id === r.id)?.type }));
    throw new Error(`demo (${label}): ${results.length}/${mutations.length} answered, refused ${JSON.stringify(why)}`);
  }
  return results.length;
}

const must = <T extends { ok: boolean }>(what: string, r: T) => {
  if (!r.ok) throw new Error(`demo: ${what} ${JSON.stringify(r)}`);
};

// ══ Ferme Démo Ben Ahmed (individual: the receipts-and-expenses book) ══
const a = {
  farm: uuidv7(), h1: uuidv7(), h2: uuidv7(), h3: uuidv7(), feedCo: uuidv7(), vetCo: uuidv7(),
  starter: uuidv7(), grower: uuidv7(), finisher: uuidv7(), layerFeed: uuidv7(), medicine: uuidv7(),
  closed: uuidv7(), open: uuidv7(), layers: uuidv7(), plan: uuidv7(), cash: uuidv7(), bank: uuidv7(),
  butcher: uuidv7(), abattoir: uuidv7(), trader: uuidv7(), grocer: uuidv7(), eggTrader: uuidv7(),
  said: uuidv7(), youssef: uuidv7(), routine: uuidv7(), cleanout: uuidv7(), powerCut: uuidv7(),
};
const feedA: Feed = { starter: a.starter, grower: a.grower, finisher: a.finisher };

// The closed batch: 8 000 chicks in house 1, sold at 40–42 days (the last sale closes it), then a clean-out.
const closedOn = ago(100);
const closedDay = (age: number) => addFarmDays(closedOn, age);
const closed = raise(a.closed, closedOn, 8000 - 12, 42, feedA, { 40: 2000, 41: 3000 });
// The open batch: house 1 again, day 24 today; today's entry is left for the presentation.
const openOn = ago(24);
const openDay = (age: number) => addFarmDays(openOn, age);
const open = raise(a.open, openOn, 8000 - 12, 23, feedA);
// The laying flock: 5 000 point-of-lay hens at 22 weeks, three weeks ago, in house 3.
const layersOn = ago(21);
const hens = 5000;

const layerDays: Mutation[] = [];
const collections: Mutation[] = [];
let layerFeedUsed = 0;
let eggsLaid = 0;
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
  collections.push(m("eggs.recordCollection", { id: uuidv7(), batchId: a.layers, day, counts, sample: { count: 30, grams: 30 * 61 } }));
}
// Egg sales every three days, by the tray of 30; the rest stays in stock.
const eggSales = [19, 16, 13, 10, 7, 4, 1].map((n, i) => {
  const eggs = 12_000;
  const cash = i % 2 === 0;
  const total = (BigInt(eggs) * 3600n * 2n + 30n) / 60n;
  return m("sales.recordEggSale", { id: uuidv7(), batchId: a.layers, buyerId: cash ? a.grocer : a.eggTrader, day: ago(n), lines: [{ item: "ungraded", eggs, eggsPerTray: 30, unitPriceCentimes: "3600" }], paymentMethod: cash ? "cash" : "credit", paidCentimes: cash ? String(total) : "0", instrument: null });
});
if (eggSales.length * 12_000 >= eggsLaid) throw new Error("demo: more eggs sold than laid");

// Feed bought ahead of each phase; the grower left after the open batch's entries falls under its alert threshold.
const growerLeft = 700_000;
const buyFeed = [
  purchase(a.feedCo, a.starter, addFarmDays(closedOn, -2), tonnes(closed.used[a.starter]), "560", "all"),
  purchase(a.feedCo, a.grower, closedDay(9), tonnes(closed.used[a.grower]), "540", "all"),
  purchase(a.feedCo, a.finisher, closedDay(23), tonnes(closed.used[a.finisher]), "520", 6_000_000n, "transfer", closedDay(60)), // half now, the rest later
  purchase(a.feedCo, a.starter, addFarmDays(openOn, -2), tonnes(open.used[a.starter] - (tonnes(closed.used[a.starter]) - closed.used[a.starter])), "560", "all"),
];
const growerStock = tonnes(closed.used[a.grower]) - closed.used[a.grower];
buyFeed.push(purchase(a.feedCo, a.grower, openDay(9), Math.max(1_000_000, open.used[a.grower] - growerStock + growerLeft), "545", "all"));
buyFeed.push(purchase(a.feedCo, a.finisher, ago(2), 24_000_000, "525", "none", "cash", addFarmDays(today, 28))); // on credit, due in four weeks
buyFeed.push(purchase(a.feedCo, a.layerFeed, addFarmDays(layersOn, -1), tonnes(layerFeedUsed) + 3_000_000, "480", "all"));

const finalBirds = closed.alive; // the last buyer takes what is left
const attendanceMonth = ago(Number(today.slice(8, 10))).slice(0, 7); // last month
const monthDays = Array.from({ length: 31 }, (_, i) => `${attendanceMonth}-${String(i + 1).padStart(2, "0")}`).filter((d) => farmDayOf(new Date(`${d}T12:00:00Z`)) === d);
const presence = (employeeId: string, day: string, i: number) => {
  const friday = new Date(`${day}T12:00:00Z`).getUTCDay() === 5;
  const status = friday ? "rest" : employeeId === a.youssef && i === 10 ? "leave" : "present";
  return m("workforce.setAttendance", { id: attendanceId(employeeId, day), employeeId, day, status, arrivedAt: status === "present" ? "07:00" : null });
};
const thisMonth = Array.from({ length: Number(today.slice(8, 10)) - 1 }, (_, i) => `${today.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`);
const payDay = thisMonth[2] ?? today;
const routineKey = `routine:${a.routine}`;

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
  m("finance.createTreasuryAccount", { id: a.cash, kind: "cash", name: "Caisse de la ferme" }),
  m("finance.createTreasuryAccount", { id: a.bank, kind: "bank", name: "Banque Démo" }),
  m("inventory.createSupplier", { id: a.feedCo, name: "Provende Démo du Centre", phone: null }),
  m("inventory.createSupplier", { id: a.vetCo, name: "Pharmacie vétérinaire Démo", phone: null }),
  m("inventory.createStockItem", { id: a.starter, farmId: a.farm, productId: "feed-starter", kind: "feed", name: "Aliment démarrage", unit: "kg", lot: null, expiresOn: null }),
  m("inventory.createStockItem", { id: a.grower, farmId: a.farm, productId: "feed-grower", kind: "feed", name: "Aliment croissance", unit: "kg", lot: null, expiresOn: null, lowStockThreshold: 2_000_000 }),
  m("inventory.createStockItem", { id: a.finisher, farmId: a.farm, productId: "feed-finisher", kind: "feed", name: "Aliment finition", unit: "kg", lot: null, expiresOn: null, lowStockThreshold: 3_000_000 }),
  m("inventory.createStockItem", { id: a.layerFeed, farmId: a.farm, productId: null, kind: "feed", name: "Aliment pondeuse", unit: "kg", lot: null, expiresOn: null, lowStockThreshold: 2_000_000 }),
  m("inventory.createStockItem", { id: a.medicine, farmId: a.farm, productId: null, kind: "medicine", name: "Antibiotique (ordonnance démo)", unit: "ml", lot: "LOT-DEMO-1", expiresOn: addFarmDays(today, 300) }),
  m("sales.createBuyer", { id: a.butcher, name: "Boucherie Démo Ben Ahmed", phone: null, type: "trader" }),
  m("sales.createBuyer", { id: a.abattoir, name: "Abattoir Démo Settat", phone: null, type: "abattoir", address: "Zone industrielle, Settat (fictif)" }),
  m("sales.createBuyer", { id: a.trader, name: "Hamid, marchand (démo)", phone: null, type: "trader" }),
  m("sales.createBuyer", { id: a.grocer, name: "Épicerie Démo", phone: null, type: "other" }),
  m("sales.createBuyer", { id: a.eggTrader, name: "Grossiste œufs Démo", phone: null, type: "trader" }),
  m("workforce.createEmployee", { id: a.said, farmId: a.farm, name: "Saïd Démo", job: "lead", phone: null, housedOnFarm: true, startedOn: ago(200), leftOn: null, dailyWageCentimes: "13000", cnssNumber: null, houseIds: [a.h1, a.h2] }),
  m("workforce.createEmployee", { id: a.youssef, farmId: a.farm, name: "Youssef Démo", job: "worker", phone: null, housedOnFarm: false, startedOn: ago(150), leftOn: null, dailyWageCentimes: "11000", cnssNumber: null, houseIds: [a.h3] }),
  m("documents.createDocument", { id: uuidv7(), title: "Autorisation sanitaire ONSSA (démo)", category: "authorization", farmId: a.farm, issuedOn: ago(340), expiresOn: addFarmDays(today, 25), notes: "Numéro fictif DEMO-ONSSA-0001" }),
  m("documents.createDocument", { id: uuidv7(), title: "Contrat vétérinaire sanitaire (démo)", category: "vetContract", farmId: a.farm, issuedOn: ago(200), expiresOn: addFarmDays(today, 165), notes: null }),
  m("documents.createDocument", { id: uuidv7(), title: "Assurance des bâtiments (démo)", category: "insurance", farmId: a.farm, issuedOn: ago(370), expiresOn: ago(5), notes: "À renouveler" }),
  m("documents.createDocument", { id: uuidv7(), title: "Analyse d'eau (démo)", category: "labReport", farmId: a.farm, issuedOn: ago(40), expiresOn: null, notes: null }),
];

const money: Mutation[] = [
  m("finance.recordTransfer", { id: uuidv7(), day: ago(103), amountCentimes: dh(60_000), fromId: a.bank, toId: a.cash }), // cash for the chicks and the daily costs
  m("finance.recordExpense", { id: uuidv7(), day: ago(85), category: "electricity", amountCentimes: dh(3_850), paidFrom: "bank", treasuryId: a.bank, note: "Facture ONEE (démo)" }),
  m("finance.recordExpense", { id: uuidv7(), day: ago(55), category: "electricity", amountCentimes: dh(3_420), paidFrom: "bank", treasuryId: a.bank, note: "Facture ONEE (démo)" }),
  m("finance.recordExpense", { id: uuidv7(), day: ago(25), category: "electricity", amountCentimes: dh(3_960), paidFrom: "bank", treasuryId: a.bank, note: "Facture ONEE (démo)" }),
  m("finance.recordExpense", { id: uuidv7(), day: ago(40), category: "water", amountCentimes: dh(640), paidFrom: "cash", treasuryId: a.cash, note: null }),
  m("finance.recordExpense", { id: uuidv7(), day: closedDay(42), category: "catching", amountCentimes: dh(2_300), paidFrom: "cash", treasuryId: a.cash, note: "Équipe de ramassage", batchId: a.closed }),
  m("finance.recordExpense", { id: uuidv7(), day: closedDay(14), category: "vet_fees", amountCentimes: dh(600), paidFrom: "cash", treasuryId: a.cash, note: "Visite et ordonnance", batchId: a.closed }),
  m("finance.recordExpense", { id: uuidv7(), day: openDay(18), category: "vet_fees", amountCentimes: dh(800), paidFrom: "credit", treasuryId: null, note: "Visite et ordonnance, à payer", batchId: a.open }),
  m("finance.recordExpense", { id: uuidv7(), day: ago(30), category: "bank_fees", amountCentimes: dh(45), paidFrom: "bank", treasuryId: a.bank, note: null }),
  m("finance.recordTransfer", { id: uuidv7(), day: closedDay(43), amountCentimes: dh(55_000), fromId: a.cash, toId: a.bank }), // the cash sale deposited
];

const sales: Mutation[] = [
  sale(a.closed, a.butcher, closedDay(40), 2000, 2_350, 1500, "cash", "all"),
  sale(a.closed, a.abattoir, closedDay(41), 3000, 2_420, 1480, "cheque", "all", { number: "CHQ-DEMO-0001", dueOn: closedDay(55) }),
  sale(a.closed, a.trader, closedDay(42), finalBirds, 2_480, 1520, "credit", "none"), // closes the batch
  m("sales.recordPayment", { id: uuidv7(), buyerId: a.trader, day: closedDay(50), amountCentimes: dh(40_000), method: "cash", instrument: null }),
  m("sales.setCreditLimit", { buyerId: a.trader, limitCentimes: dh(50_000) }), // he still owes more: over his limit
  m("sales.setCreditLimit", { buyerId: a.eggTrader, limitCentimes: dh(60_000) }),
];

const health = (batchId: string, placedOn: FarmDay, start: number, withdrawalDays: number, ref: string) => [
  m("health.recordVetVisit", { id: uuidv7(), batchId, on: addFarmDays(placedOn, start), vetName: "Dr Vétérinaire Démo", notes: "Râles chez quelques sujets ; traitement prescrit. Visite fictive (démo)." }),
  // The withdrawal is the demo prescription's, typed as the farmer would: never a product's default.
  m("health.recordTreatment", { id: uuidv7(), batchId, stockItemId: a.medicine, quantity: 800, dose: "1 ml par litre d'eau (ordonnance démo)", startOn: addFarmDays(placedOn, start), endOn: addFarmDays(placedOn, start + 4), reason: "Troubles respiratoires (démo)", prescriber: "Dr Vétérinaire Démo", withdrawalDays, route: "drinkingWater", prescriptionRef: ref }),
];

const compliance: Mutation[] = [
  m("biosecurity.startCleanout", { id: a.cleanout, houseId: a.h1, afterBatchId: a.closed, startedOn: closedDay(44) }),
  ...(
    [["manureOut", 44, null], ["equipmentWashed", 45, null], ["pressureWash", 46, null], ["disinfection", 48, "Désinfectant (démo)"], ["rodentControl", 49, "Appât (démo)"], ["waterFlush", 50, null], ["litterPreheat", 74, null]] as const
  ).map(([step, age, product]) => m("biosecurity.recordCleanoutStep", { id: uuidv7(), cleanoutId: a.cleanout, step, day: closedDay(age), product, dose: null, productLot: null, note: null })),
  m("biosecurity.recordManure", { id: uuidv7(), farmId: a.farm, day: closedDay(44), houseId: a.h1, batchId: a.closed, quantityKg: 18_000, destination: "sold", recipient: "Agriculteur voisin (démo)" }),
  m("biosecurity.recordVisit", { id: uuidv7(), farmId: a.farm, enteredAt: at(ago(10), "09:30"), visitor: "Livreur Provende Démo", vehicle: "12345-A-6", purpose: "feedDelivery", recentFarm: true, wheelsDisinfected: true, footbath: true, farmClothing: false, zone: "dirty" }),
  m("biosecurity.recordVisit", { id: uuidv7(), farmId: a.farm, enteredAt: at(openDay(18), "10:00"), visitor: "Dr Vétérinaire Démo", vehicle: null, purpose: "vet", recentFarm: false, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "clean" }),
  m("biosecurity.recordVisit", { id: uuidv7(), farmId: a.farm, enteredAt: at(ago(2), "15:15"), visitor: "Acheteur Démo", vehicle: "67890-B-6", purpose: "buyer", recentFarm: false, wheelsDisinfected: false, footbath: true, farmClothing: false, zone: "dirty" }),
  m("biosecurity.recordDisposal", { id: uuidv7(), farmId: a.farm, day: ago(2), batchId: a.open, birds: 9, weightGrams: 9 * 900, method: "sealedPit", methodNote: null }),
  m("biosecurity.recordRodentCheck", { id: uuidv7(), farmId: a.farm, houseId: a.h1, day: ago(14), action: "baitPlaced", product: "Appât (démo)" }),
  m("biosecurity.recordRodentCheck", { id: uuidv7(), farmId: a.farm, houseId: a.h1, day: ago(7), action: "baitChecked", product: null }),
  ...[3, 2, 1].flatMap((n, i) =>
    ([["08:00", 286, 62, 12], ["14:00", 301, 55, 9], ["20:00", 279, 66, 15]] as const).map(([time, t, rh, nh3]) =>
      m("climate.recordReading", { id: uuidv7(), houseId: a.h1, day: ago(n), time, temperatureTenths: t - i * 4, humidity: rh, ammonia: nh3 }),
    ),
  ),
  m("climate.startPowerCut", { id: a.powerCut, farmId: a.farm, startedAt: at(ago(4), "10:05") }),
  m("climate.endPowerCut", { id: a.powerCut, endedAt: at(ago(4), "12:35"), generatorStarted: true, generatorSeconds: 2 * 3600 + 20 * 60, dieselMl: 18_000 }),
];

const team: Mutation[] = [
  ...monthDays.flatMap((d, i) => [presence(a.said, d, i), presence(a.youssef, d, i)]),
  m("workforce.validatePay", { farmId: a.farm, month: attendanceMonth }),
  m("workforce.payWages", { farmId: a.farm, month: attendanceMonth, day: payDay, paidFrom: "cash" }),
  ...thisMonth.flatMap((d, i) => [presence(a.said, d, i), presence(a.youssef, d, i + 1)]),
  m("workforce.recordAdvance", { id: uuidv7(), employeeId: a.youssef, day: thisMonth.at(-1) ?? today, amountCentimes: dh(500), deductMonth: today.slice(0, 7), note: "Avance (démo)" }),
  m("workforce.saveRoutine", { id: a.routine, farmId: a.farm, houseId: null, employeeId: a.said, title: "Contrôler les abreuvoirs et les pipettes", time: "07:30", everyDays: 1, startOn: ago(30), fromAge: null, stopOn: null }),
  ...[2, 1].map((n) => m("workforce.tickTask", { id: taskDoneId(routineKey, ago(n)), farmId: a.farm, key: routineKey, day: ago(n) })),
];

const pushedA = await apply(A, "Ferme Démo Ben Ahmed", [
  ...farmA,
  purchase(a.vetCo, a.medicine, closedDay(10), 2000, "35", "all", "cash"),
  ...buyFeed,
  place(a.closed, a.h1, closedOn, 8000, "BL-DEMO-101", { paidOnDelivery: { cashAccountId: a.cash, amountCentimes: String(8000 * 550) } }),
  ...closed.entries,
  ...weighings(a.closed, closedOn, [[7, 170], [14, 430], [21, 850], [28, 1_350], [35, 1_900], [42, 2_450]]),
  ...health(a.closed, closedOn, 12, 5, "ORD-DEMO-01"),
  ...sales,
  place(a.open, a.h1, openOn, 8000, "BL-DEMO-102"), // chicks still to pay: a debt on the money view
  ...open.entries,
  ...weighings(a.open, openOn, [[7, 165], [14, 420], [21, 830]]),
  ...health(a.open, openOn, 18, 7, "ORD-DEMO-02"), // withdrawal still running today
  m("flock.placeBatch", { id: a.layers, houseId: a.h3, species: "layer", strainId: "lohmann-brown", placedOn: layersOn, chicksPlaced: hens, deadOnArrival: 0, hatchery: "Élevage de poulettes Démo", deliveryNote: "BL-DEMO-201", chickUnitPriceCentimes: "5500", dayOldWeightGrams: null, ageAtPlacementDays: 154 }),
  ...layerDays,
  ...collections,
  ...eggSales,
  m("planning.savePlan", { id: a.plan, houseId: a.h2, placeOn: addFarmDays(today, 12), chicks: 7000, strainId: "ross-308", hatchery: "Couvoir Démo", chickPriceCentimes: "560", saleAge: 42 }),
  ...money,
  ...compliance,
  ...team,
]);
must("contribution", await recordAssociateMovement(A, { id: uuidv7(), day: ago(105), direction: "contribution", amountCentimes: dh(350_000), treasuryId: a.bank, associate: null }));
must("budget", await saveBudget(A, { id: uuidv7(), name: "Bande en cours, bâtiment 1 (démo)", basedOn: null, batchId: a.open, chicks: "8000", chickPriceCentimes: "550", feedGrams: "35000000", feedPricePerKgCentimes: "535", otherCostCentimes: dh(18_000), plannedGrams: "18800000", salePricePerKgCentimes: "1500", saleDay: "42" }));
must("vet invitation", await inviteMember(A, { phone: PHONES.vet, role: "vet", accessUntil: addFarmDays(today, 90) }));
must("accountant invitation", await inviteMember(A, { phone: PHONES.accountant, role: "accountant", accessUntil: null }));

// ══ SARL Démo Avicole (company: full books and statements) ══
const b = { farm: uuidv7(), house: uuidv7(), feedCo: uuidv7(), starter: uuidv7(), grower: uuidv7(), finisher: uuidv7(), closed: uuidv7(), open: uuidv7(), bank: uuidv7(), cash: uuidv7(), abattoir: uuidv7(), trader: uuidv7() };
const feedB: Feed = { starter: b.starter, grower: b.grower, finisher: b.finisher };
const bClosedOn = ago(80);
const bDay = (age: number) => addFarmDays(bClosedOn, age);
const bClosed = raise(b.closed, bClosedOn, 6000 - 9, 42, feedB, { 41: 3500 });
const bOpenOn = ago(12);
const bOpen = raise(b.open, bOpenOn, 6000 - 9, 11, feedB);
const pushedB = await apply(B, "SARL Démo Avicole", [
  m("farm-registry.createFarm", { id: b.farm, name: "Ferme Démo Berrechid", region: "Casablanca-Settat", province: "Berrechid", commune: "Had Soualem", gps: null, onssa: { number: "DEMO-ONSSA-0002", expiresOn: addFarmDays(today, 200) } }),
  m("farm-registry.createHouse", { id: b.house, farmId: b.farm, name: "Bâtiment A", areaM2: 900, capacity: 8000, type: "closed" }),
  m("finance.createTreasuryAccount", { id: b.bank, kind: "bank", name: "Banque Démo SARL" }),
  m("finance.createTreasuryAccount", { id: b.cash, kind: "cash", name: "Caisse SARL" }),
  m("inventory.createSupplier", { id: b.feedCo, name: "Provende Démo du Centre", phone: null }),
  ...([["starter", "feed-starter", "Aliment démarrage"], ["grower", "feed-grower", "Aliment croissance"], ["finisher", "feed-finisher", "Aliment finition"]] as const).map(([k, productId, name]) =>
    m("inventory.createStockItem", { id: b[k], farmId: b.farm, productId, kind: "feed", name, unit: "kg", lot: null, expiresOn: null }),
  ),
  m("sales.createBuyer", { id: b.abattoir, name: "Abattoir Démo Berrechid", phone: null, type: "abattoir" }),
  m("sales.createBuyer", { id: b.trader, name: "Marchand Démo Casablanca", phone: null, type: "trader" }),
  purchase(b.feedCo, b.starter, addFarmDays(bClosedOn, -2), tonnes(bClosed.used[b.starter] + bOpen.used[b.starter]), "560", "all"),
  purchase(b.feedCo, b.grower, bDay(9), tonnes(bClosed.used[b.grower] + bOpen.used[b.grower]), "540", "all"),
  purchase(b.feedCo, b.finisher, bDay(23), tonnes(bClosed.used[b.finisher]), "520", "none", "transfer", bDay(70)), // on credit
  place(b.closed, b.house, bClosedOn, 6000, "BL-DEMO-301"),
  ...bClosed.entries,
  ...weighings(b.closed, bClosedOn, [[7, 172], [21, 860], [35, 1_920], [42, 2_460]]),
  sale(b.closed, b.abattoir, bDay(41), 3500, 2_400, 1490, "transfer", "all"),
  sale(b.closed, b.trader, bDay(42), bClosed.alive, 2_470, 1510, "cheque", "all", { number: "CHQ-DEMO-0002", dueOn: bDay(60) }),
  place(b.open, b.house, bOpenOn, 6000, "BL-DEMO-302"),
  ...bOpen.entries,
  ...weighings(b.open, bOpenOn, [[7, 168]]),
  m("inventory.recordSupplierPayment", { id: uuidv7(), supplierId: b.feedCo, day: bDay(60), amountCentimes: dh(40_000), method: "transfer", instrument: null }),
  m("finance.recordTransfer", { id: uuidv7(), day: ago(70), amountCentimes: dh(10_000), fromId: b.bank, toId: b.cash }),
  m("finance.recordExpense", { id: uuidv7(), day: ago(60), category: "electricity", amountCentimes: dh(3_100), paidFrom: "bank", treasuryId: b.bank, note: "Facture (démo)" }),
  m("finance.recordExpense", { id: uuidv7(), day: ago(30), category: "electricity", amountCentimes: dh(2_900), paidFrom: "bank", treasuryId: b.bank, note: "Facture (démo)" }),
  m("finance.recordExpense", { id: uuidv7(), day: ago(50), category: "insurance", amountCentimes: dh(4_200), paidFrom: "bank", treasuryId: b.bank, note: "Assurance multirisque (démo)" }),
  m("finance.recordExpense", { id: uuidv7(), day: bDay(42), category: "catching", amountCentimes: dh(1_800), paidFrom: "cash", treasuryId: b.cash, note: null, batchId: b.closed }),
]);
must("SARL contribution", await recordAssociateMovement(B, { id: uuidv7(), day: ago(85), direction: "contribution", amountCentimes: dh(300_000), treasuryId: b.bank, associate: "Associé démo" }));
must("SARL accountant invitation", await inviteMember(B, { phone: PHONES.accountant, role: "accountant", accessUntil: null }));

await postPending(A); // the books, as the push route does after a phone's push
await postPending(B);

console.log(`demo: ${pushedA + pushedB} writes applied, in two organisations: « Ferme Démo Ben Ahmed » (individual) and « SARL Démo Avicole » (company).`);
console.log(`demo: sign in with the phone number ${phone}: the one-time code goes to the SMS sender (in development, OTP_CONSOLE_SINK=1 prints it in the server log).`);
console.log(`demo: pending invitations (no SMS sent): vet ${PHONES.vet}, accountant ${PHONES.accountant}. DEMO ONLY: every name and figure is made up.`);
await db.$disconnect();
