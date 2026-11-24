import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import type { PullResponse, PushedMutation } from "@/lib/sync/protocol";
import { pull, push, recordChange } from "@/lib/sync/server";
import { pulls } from "@/lib/sync/views";
import type { Role, TenantContext } from "@/lib/tenant";
import { planFor } from "@/modules/health/shared";
import { notify } from "@/modules/notifications";
import { TEMPLATE_KEYS, type TemplateKey } from "@/modules/notifications/shared";
import { attendanceId, taskAssignmentId, taskDoneId, taskKey } from "@/modules/workforce/shared";
import { twoTenants } from "@/test/tenant";
import { registry } from "./registry";

// SPEC I5, SPEC-m4 WF3, SPEC-finance FCX1, SPEC-m5 §5 and PA1–PA6: what each role's phone pulls, from real records of
// every synced entity, written through the same mutations as a phone. Per-module tests check each serializer; this one
// checks the whole pull at once, so a new entity or a new money field can't slip past a role.

const ROLES = ["owner", "manager", "worker", "vet", "accountant"] as const satisfies readonly Role[];
const ALL = ROLES;
const STAFF = ["owner", "manager", "worker"] as const;
const MONEY = ["owner", "manager", "accountant"] as const; // money.read

/**
 * Per synced entity, the roles whose phone receives it. A worker receives some of these without their money fields
 * (asserted below), and attendance and notifications only when they are their own. A new entity fails the guard until
 * it gets a row here.
 */
const RECEIVED_BY: Record<string, readonly Role[]> = {
  farm: ALL, house: ALL, batch: ALL, soldBirds: ALL, stockItem: ALL, movement: ALL, notification: ALL,
  dailyEntry: [...STAFF, "vet"], weighing: [...STAFF, "vet"], protocol: [...STAFF, "vet"],
  vaccination: [...STAFF, "vet"], treatment: [...STAFF, "vet"], vetVisit: [...STAFF, "vet"],
  // Money stripped for workers (withoutMoney); whole for the accountant.
  batchCost: [...STAFF, "accountant"], supplier: [...STAFF, "accountant"], purchase: [...STAFF, "accountant"],
  supplierPayment: [...STAFF, "accountant"], buyer: [...STAFF, "accountant"], sale: [...STAFF, "accountant"],
  buyerPayment: [...STAFF, "accountant"], employee: [...STAFF, "accountant"],
  // Money only: never a worker's or a vet's.
  issuedDebit: MONEY, instrumentStatus: MONEY, treasuryAccount: MONEY, expense: MONEY, transfer: MONEY,
  advance: MONEY, payMonth: MONEY, payPayment: MONEY, labourRules: MONEY, price: MONEY,
  staffRecord: ["owner", "manager"], document: ["owner", "manager"],
  // The farm's own work, no money: staff only, neither partner (SPEC-m5 §8).
  attendance: STAFF, routine: STAFF, oneOffTask: STAFF, taskDone: STAFF, taskAssignment: STAFF,
  climateTargets: STAFF, climateReading: STAFF, powerCut: STAFF, plannedBatch: STAFF, downtimeRule: STAFF,
  eggCollection: STAFF, eggGrading: STAFF, eggDiscard: STAFF, eggDraw: STAFF,
  visit: STAFF, disposal: STAFF, manureRemoval: STAFF, cleanout: STAFF, rodentCheck: STAFF,
};

/** SPEC-m5 §5 / PA5: the accountant gets what finance, sales, inventory and pay hold, plus farm, house and batch. */
const ACCOUNTANT = [
  "farm", "house", "batch", "soldBirds", "batchCost", // the batches the money relates to
  "supplier", "stockItem", "movement", "purchase", "supplierPayment", "issuedDebit", // inventory
  "buyer", "sale", "buyerPayment", "instrumentStatus", // sales
  "treasuryAccount", "expense", "transfer", // finance
  "employee", "advance", "payMonth", "payPayment", "labourRules", // pay
  "price", // SPEC-m5 MP1: accountants receive prices
  "notification", // their own inbox
];

/** Each template's params as its sender writes them (amounts already formatted). */
const PARAMS: Record<TemplateKey, Record<string, string>> = {
  test: {},
  lowStock: { item: "Démarrage", quantity: "40", unit: "kg", threshold: "50" },
  vaccineTomorrow: { vaccineFr: "Gumboro", vaccineAr: "Gumboro", house: "Bâtiment 1", age: "14", method: "drinkingWater" },
  vaccineToday: { vaccineFr: "Gumboro", vaccineAr: "Gumboro", house: "Bâtiment 1", age: "14", method: "drinkingWater" },
  instrumentDue: { method: "cheque", number: "CHQ-1", buyer: "Hamid", amount: "1 450,00 DH" },
  issuedDue: { method: "cheque", number: "CHQ-9", supplier: "Alf", amount: "1 000,00 DH" },
  creditApproval: { buyer: "Hamid", amount: "3 000,00 DH", limit: "10 000,00 DH" },
  climateOutOfRange: { house: "Bâtiment 1", age: "40", values: "24,5 °C" },
  powerCut: { time: "14:20" },
  placementTomorrow: { house: "Bâtiment 1", chicks: "10000", hatchery: "Couvoir X" },
  documentExpiring: { title: "Assurance", date: "30/11/2027" },
  documentExpired: { title: "Assurance", date: "30/11/2027" },
  thresholdNear: { percent: "90" },
  loanDue: { lender: "Banque", number: "3", amount: "2 500,00 DH" },
};

const MONEY_KEY = /centimes|price|amount|wage|salary|cnss|balance|credit/i;
// Keys that match MONEY_KEY without being money. Keep it short, each with its reason.
const NOT_MONEY: readonly string[] = [];

/** Every key path in `value` that looks like money, e.g. "sale.pricePerKgCentimes". */
function moneyKeys(value: unknown, path: string): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => moneyKeys(v, `${path}[${i}]`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => [...(MONEY_KEY.test(k) && !NOT_MONEY.includes(k) ? [`${path}.${k}`] : []), ...moneyKeys(v, `${path}.${k}`)]);
}

async function pullAll(ctx: TenantContext) {
  const changes: PullResponse["changes"] = [];
  for (let since = 0, more = true; more; ) {
    const page = await pull(ctx, since, registry);
    changes.push(...page.changes);
    [since, more] = [page.version, page.hasMore];
  }
  return changes;
}

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
const refused = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.flatMap((r, i) => (r.status === "rejected" ? [`${ms[i].type}: ${r.messageKey}`] : []));

describe("what each role's phone pulls (SPEC I5, WF3, FCX1, SPEC-m5 §5)", () => {
  let a: TenantContext, b: TenantContext;
  const as: Partial<Record<Role, TenantContext>> = {};
  const pulled: Partial<Record<Role, PullResponse["changes"]>> = {};
  const seeded = new Set<string>(); // every record id the owner's pull holds
  const id = new Proxy({} as Record<string, string>, { get: (ids, key: string) => (ids[key] ??= uuidv7()) });

  beforeAll(async () => {
    await db.strain.createMany({ data: [{ id: "ross-308", name: "Ross 308" }, { id: "lohmann-brown", name: "Lohmann Brown", productionTypes: ["pullet", "layer"] }] });
    await db.product.createMany({
      data: [
        { id: "vaccine-gumboro", kind: "vaccine", nameFr: "Vaccin Gumboro", nameAr: "لقاح الجمبورو" },
        { id: "feed-starter", kind: "feed", nameFr: "Aliment démarrage", nameAr: "علف البداية" },
      ],
    });
    await db.eggGrade.create({ data: { id: "m", label: "M", sortOrder: 0 } });
    const items = [{ dayOfAge: 14, productId: "vaccine-gumboro", method: "drinkingWater" as const }];
    await db.protocolTemplate.create({ data: { id: "broiler-default", nameFr: "Modèle", nameAr: "نموذج", items } });
    [a, b] = await twoTenants();
    as.owner = a;
    for (const [n, role] of (["manager", "worker", "vet", "accountant"] as const).entries()) {
      const user = await db.user.create({ data: { phoneNumber: `+21260000001${n}`, name: role, email: `21260000001${n}@phone.invalid` } });
      await db.membership.create({ data: { organizationId: a.organizationId, userId: user.id, role } });
      as[role] = { userId: user.id, organizationId: a.organizationId, role };
    }

    const today = farmDayOf(new Date());
    const ago = (n: number) => addFarmDays(today, -n);
    const placedOn = ago(40);
    const house = (houseId: string, name: string) => m("farm-registry.createHouse", { id: houseId, farmId: id.farm, name, areaM2: 1000, capacity: 10000, type: "closed" });
    const place = (batchId: string, houseId: string, on: string, over: object = {}) =>
      m("flock.placeBatch", { id: batchId, houseId, strainId: "ross-308", placedOn: on, chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null, ...over });
    const lot = (itemId: string, kind: string, productId: string | null, unit: string) =>
      m("inventory.createStockItem", { id: itemId, farmId: id.farm, productId, kind, name: kind, unit, lot: "L1", expiresOn: "2027-06-30" });
    const purchase = (itemId: string, quantity: number, unitPriceCentimes: string, purchaseId = uuidv7()) =>
      m("inventory.recordPurchase", { id: purchaseId, movementId: uuidv7(), supplierId: id.supplier, stockItemId: itemId, day: ago(41), quantity, unitPriceCentimes, paidCentimes: "0", dueOn: null });
    const sale = (saleId: string, over: object = {}) =>
      m("sales.recordSale", { id: saleId, batchId: id.batch, buyerId: id.buyer, day: ago(2), birds: 50, farmWeightGrams: 100_000, buyerWeightGrams: null, pricePerKgCentimes: "1450", paymentMethod: "credit", paidCentimes: "0", instrument: null, ...over });
    const employee = (employeeId: string, phone: string | null) =>
      m("workforce.createEmployee", { id: employeeId, farmId: id.farm, name: "E", job: "worker", phone, housedOnFarm: true, startedOn: "2026-01-01", leftOn: null, dailyWageCentimes: "15000", cnssNumber: "123456789", houseIds: [] });
    const present = (employeeId: string, day: string) => m("workforce.setAttendance", { id: attendanceId(employeeId, day), employeeId, day, status: "present", arrivedAt: null });
    const routineKey = taskKey.routine(id.routine);
    const steps = [
      // farm-registry, reference-data
      m("farm-registry.createFarm", { id: id.farm, name: "El Kheir", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      house(id.house, "Bâtiment 1"), house(id.house2, "Bâtiment 2"), house(id.house3, "Pondeuses"),
      m("reference-data.copyProtocol", { id: id.protocol, templateId: "broiler-default", name: "Mon programme" }),
      // inventory, with a cancelled purchase (#230)
      m("inventory.createSupplier", { id: id.supplier, name: "Alf", phone: null }),
      lot(id.feed, "feed", "feed-starter", "kg"), lot(id.gumboro, "vaccine", "vaccine-gumboro", "dose"), lot(id.medicine, "medicine", null, "ml"),
      purchase(id.feed, 1_000_000, "450"), purchase(id.gumboro, 5000, "20"), purchase(id.medicine, 2000, "10"),
      purchase(id.feed, 10_000, "450", id.cancelledPurchase), m("inventory.cancelPurchase", { purchaseId: id.cancelledPurchase }),
      m("inventory.adjustStock", { id: uuidv7(), stockItemId: id.feed, day: ago(1), quantity: -1000, reason: "Sac percé" }),
      m("inventory.setThreshold", { stockItemId: id.feed, lowStockThreshold: 50_000 }),
      m("inventory.recordSupplierPayment", { id: id.supplierCheque, supplierId: id.supplier, day: ago(3), amountCentimes: "100000", method: "cheque", instrument: { number: "CHQ-9", dueOn: ago(1) } }),
      m("inventory.debitIssued", { id: uuidv7(), instrumentId: id.supplierCheque, day: ago(1) }),
      // flock: an open broiler batch, a closed one, a laying flock
      place(id.batch, id.house, placedOn),
      m("flock.recordDay", { batchId: id.batch, day: ago(39), changes: { dead: 2, culled: 0, feed: { stockItemId: id.feed, grams: 100_000 } } }),
      m("flock.recordWeighing", { id: uuidv7(), batchId: id.batch, day: ago(33), sample: { totalGrams: 9_600, count: 50 } }),
      place(id.closed, id.house2, ago(60)),
      m("flock.closeBatch", { batchId: id.closed, day: ago(5), reason: "Fin de lot" }),
      place(id.layers, id.house3, ago(10), { species: "layer", strainId: "lohmann-brown", ageAtPlacementDays: 200 }),
      // health
      m("health.planVaccinations", { batchId: id.batch, protocolId: id.protocol, items }),
      m("health.recordVaccination", { id: planFor(id.batch, placedOn, items)[0].id, on: addFarmDays(placedOn, 14), stockItemId: id.gumboro, doses: 990, method: "drinkingWater" }),
      m("health.recordTreatment", { id: uuidv7(), batchId: id.batch, stockItemId: id.medicine, quantity: 500, dose: "1 ml par litre", startOn: ago(20), endOn: ago(17), reason: "Toux", prescriber: "Dr Alaoui", withdrawalDays: 5 }),
      m("health.recordVetVisit", { id: uuidv7(), batchId: id.batch, on: ago(20), vetName: "Dr Alaoui", notes: "Toux" }),
      // eggs, and an egg sale (its draws)
      m("eggs.recordCollection", { id: uuidv7(), batchId: id.layers, day: ago(2), counts: { normal: 600, cracked: 0, dirty: 0, doubleYolk: 0, floor: 0, broken: 0 }, sample: null }),
      m("eggs.gradeEggs", { id: uuidv7(), batchId: id.layers, laidOn: ago(2), grades: { m: 100 } }),
      m("eggs.discardEggs", { id: uuidv7(), batchId: id.layers, laidOn: ago(2), item: "grade:m", eggs: 10, reason: "Cassés" }),
      // sales: credit, cheque, payment, consumption, a cancelled and a corrected sale (#230), a held credit sale
      m("sales.createBuyer", { id: id.buyer, name: "Abattoir Atlas", phone: null, type: "abattoir" }),
      m("sales.setBuyerAddress", { buyerId: id.buyer, address: "12 route de Casablanca, Settat" }),
      m("sales.setCreditLimit", { buyerId: id.buyer, limitCentimes: "1000000" }),
      sale(id.sale),
      sale(id.chequeSale, { paymentMethod: "cheque", paidCentimes: "145000", instrument: { number: "CHQ-1", dueOn: ago(1) } }),
      m("sales.setInstrumentState", { id: uuidv7(), instrumentId: id.chequeSale, state: "remitted", day: ago(1) }),
      m("sales.recordPayment", { id: uuidv7(), buyerId: id.buyer, day: ago(1), amountCentimes: "10000", method: "cash" }),
      sale(id.cancelledSale), m("sales.cancelSale", { saleId: id.cancelledSale }),
      sale(id.correctedSale), m("sales.correctSale", { saleId: id.correctedSale, pricePerKgCentimes: "1500", linePrices: [], vatCentimes: "0" }),
      m("sales.recordConsumption", { id: uuidv7(), batchId: id.batch, day: ago(1), takenBy: "employee", kind: "live", birds: 5, farmWeightGrams: 10_000 }),
      m("sales.recordEggSale", { id: uuidv7(), batchId: id.layers, buyerId: id.buyer, day: ago(1), lines: [{ item: "ungraded", eggs: 300, unitPriceCentimes: "3300" }], paymentMethod: "cash", paidCentimes: "33000", instrument: null }),
      // finance, with a corrected and a cancelled expense (#230)
      m("finance.createTreasuryAccount", { id: id.cash, kind: "cash", name: "Caisse" }),
      m("finance.createTreasuryAccount", { id: id.bank, kind: "bank", name: "Banque" }),
      m("finance.recordTransfer", { id: uuidv7(), day: ago(3), amountCentimes: "10000", fromId: id.bank, toId: id.cash }),
      ...[id.expense, id.cancelledExpense].map((e) => m("finance.recordExpense", { id: e, day: ago(3), category: "electricity", amountCentimes: "390000", paidFrom: "credit", treasuryId: null, note: null, batchId: null, serviceMonth: null })),
      m("finance.correctExpense", { id: id.expense, day: ago(3), category: "electricity", amountCentimes: "380000", paidFrom: "credit", treasuryId: null, note: null, batchId: null, serviceMonth: null }),
      m("finance.cancelExpense", { expenseId: id.cancelledExpense }),
      // workforce: Said is the worker's employee record (linked by phone), Hamid is someone else
      employee(id.said, "0600000011"), employee(id.hamid, null),
      present(id.said, "2026-09-01"), present(id.hamid, "2026-09-01"),
      m("workforce.recordAdvance", { id: uuidv7(), employeeId: id.said, day: "2026-09-02", amountCentimes: "5000", deductMonth: "2026-09", note: null }),
      m("workforce.saveLabourRules", { id: uuidv7(), validFrom: "2026-01-01", source: "Test, not a real circular", smagDailyCentimes: "10000", employeeCappedBp: 400, employeeUncappedBp: 200, employerCappedBp: 800, employerUncappedBp: 1000, monthlyCapCentimes: "300000" }),
      m("workforce.validatePay", { farmId: id.farm, month: "2026-09" }),
      m("workforce.payWages", { farmId: id.farm, month: "2026-09", day: "2026-09-30", paidFrom: "bank" }),
      m("workforce.addStaffRecord", { id: uuidv7(), employeeId: id.said, day: "2026-11-04", kind: "training", topic: "biosecurity", note: null }),
      m("workforce.saveRoutine", { id: id.routine, farmId: id.farm, houseId: null, employeeId: null, title: "Abreuvoirs", time: null, everyDays: 1, startOn: "2026-01-01", fromAge: null, stopOn: null }),
      m("workforce.addTask", { id: uuidv7(), farmId: id.farm, houseId: null, employeeId: null, day: addFarmDays(today, 1), title: "Camion", time: null }),
      m("workforce.tickTask", { id: taskDoneId(routineKey, today), farmId: id.farm, key: routineKey, day: today }),
      m("workforce.assignTask", { id: taskAssignmentId(a.organizationId, routineKey, today), farmId: id.farm, key: routineKey, day: today, employeeId: id.hamid }),
      // climate, market prices, planning
      m("climate.saveTargets", { id: uuidv7(), validFrom: "2026-01-01", source: "Test", bands: [{ fromAge: 30, toAge: 45, temperatureMinTenths: 100, temperatureMaxTenths: 200, humidityMin: null, humidityMax: null, ammoniaMax: null }] }),
      m("climate.recordReading", { id: uuidv7(), houseId: id.house, day: today, time: "06:00", temperatureTenths: 245, humidity: 68, ammonia: null }),
      m("climate.startPowerCut", { id: id.cut, farmId: id.farm, startedAt: new Date(Date.now() - 3_600_000).toISOString() }),
      m("climate.endPowerCut", { id: id.cut, endedAt: new Date().toISOString(), generatorStarted: true, generatorSeconds: 40, dieselMl: 18_000 }),
      m("market-prices.recordPrice", { id: uuidv7(), product: "liveBroiler", day: ago(1), priceCentimes: "1400", seenOn: "Souk" }),
      m("planning.savePlan", { id: uuidv7(), houseId: id.house, placeOn: addFarmDays(today, 30), chicks: 10_000, strainId: "ross-308", hatchery: "Couvoir X", chickPriceCentimes: "450", saleAge: 35 }),
      m("planning.saveDowntime", { id: uuidv7(), farmId: id.farm, validFrom: "2026-01-01", minDays: 28, source: "Test" }),
      // biosecurity, documents
      m("biosecurity.recordVisit", { id: uuidv7(), farmId: id.farm, enteredAt: new Date().toISOString(), visitor: "Livreur", vehicle: null, purpose: "gas", recentFarm: false, wheelsDisinfected: true, footbath: true, farmClothing: false, zone: "clean" }),
      m("biosecurity.recordDisposal", { id: uuidv7(), farmId: id.farm, day: ago(39), batchId: id.batch, birds: 2, weightGrams: 100, method: "incineration", methodNote: null }),
      m("biosecurity.recordManure", { id: uuidv7(), farmId: id.farm, day: ago(4), houseId: id.house2, batchId: id.closed, quantityKg: 18000, destination: "stored", recipient: null }),
      m("biosecurity.recordRodentCheck", { id: uuidv7(), farmId: id.farm, houseId: id.house, day: ago(2), action: "baitPlaced", product: null }),
      m("biosecurity.startCleanout", { id: id.cleanout, houseId: id.house2, afterBatchId: id.closed, startedOn: ago(4) }),
      m("biosecurity.recordCleanoutStep", { id: uuidv7(), cleanoutId: id.cleanout, step: "manureOut", day: ago(3), product: null, dose: null, productLot: null, note: null }),
      m("documents.createDocument", { id: uuidv7(), title: "Assurance", category: "insurance", farmId: null, issuedOn: null, expiresOn: "2027-11-30", notes: null }),
    ];
    expect(await refused(a, steps)).toEqual([]);
    // A manager's credit sale past the limit waits for the owner (creditApproval), who approves it.
    const held = sale(id.heldSale, { birds: 500, farmWeightGrams: 1_000_000, pricePerKgCentimes: "1500" });
    expect(await refused(as.manager!, [held])).toEqual([]);
    expect(await refused(a, [m("sales.approveCredit", { saleId: id.heldSale })])).toEqual([]);

    // Every template to every member, as if each had been an owner when it was sent (a demoted member, T25 S5).
    const users = ROLES.map((r) => as[r]!.userId);
    await db.$transaction(async (tx) => {
      for (const templateKey of TEMPLATE_KEYS) await notify(tx, a, { userIds: users, templateKey, params: PARAMS[templateKey], urgency: "normal" });
      // Retired with flock.recordBatchCost (costs are quick expenses now); phones still hold and pull these changes.
      await recordChange(tx, a, "batchCost", id.batchCost, { id: id.batchCost, batchId: id.batch, day: ago(20), label: "Électricité", amountCentimes: "20000" });
    });
    await push(b, [m("farm-registry.createFarm", { id: uuidv7(), name: "Ferme B", region: "R", province: "P", commune: "C", gps: null, onssa: null })], registry);

    for (const role of ROLES) pulled[role] = await pullAll(as[role]!);
    for (const c of pulled.owner!) seeded.add(c.id);
  }, 120_000);

  it("the table covers every synced entity, and the owner's pull holds a record of each", () => {
    expect(Object.keys(RECEIVED_BY).sort()).toEqual(Object.keys(registry.entities).sort());
    expect([...new Set(pulled.owner!.map((c) => c.entity))].sort()).toEqual(Object.keys(registry.entities).sort());
  });

  for (const role of ROLES) {
    it(`a ${role} receives exactly the entities of their role, within their pull view`, () => {
      // A deletion (data null) skips the serializer, so it reaches every role whose view holds the entity: it carries
      // only the id. Records are what this table is about.
      const got = [...new Set(pulled[role]!.filter((c) => c.data !== null).map((c) => c.entity))].sort();
      expect(got).toEqual(Object.keys(RECEIVED_BY).filter((e) => RECEIVED_BY[e].includes(role)).sort());
      expect(pulled[role]!.filter((c) => !pulls(role, c.entity))).toEqual([]); // deletions included
    });
  }

  it("a member who doesn't manage receives only their own notifications and attendance", () => {
    for (const role of ROLES) {
      const own = pulled[role]!.filter((c) => c.entity === "notification" || (c.entity === "attendance" && role === "worker"));
      expect(own.length, role).toBeGreaterThan(0);
      expect(own.filter((c) => c.data !== null && (c.data as { userId: string }).userId !== as[role]!.userId), role).toEqual([]);
    }
  });

  for (const role of ["worker", "vet"] as const) {
    it(`a ${role}'s pull carries no money field anywhere`, () => {
      expect(pulled[role]!.flatMap((c) => moneyKeys(c.data, c.entity))).toEqual([]);
    });
  }

  it("the accountant receives the SPEC-m5 §5 list, each record whole, as the owner does", () => {
    const got = pulled.accountant!;
    expect([...new Set(got.map((c) => c.entity))].sort()).toEqual([...ACCOUNTANT].sort());
    const owners = pulled.owner!.filter((c) => c.entity !== "notification" && ACCOUNTANT.includes(c.entity));
    expect(got.filter((c) => c.entity !== "notification")).toEqual(owners);
  });

  it("another organisation's pull holds none of these records", async () => {
    const theirs = await pullAll(b);
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.filter((c) => seeded.has(c.id))).toEqual([]);
  });
});
