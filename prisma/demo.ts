import { v7 as uuidv7 } from "uuid";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { push } from "@/lib/sync/server";
import { createOrganization } from "@/modules/farm-registry";

// `pnpm db:seed:demo` (T26): a demo farm to show the app, owned by DEMO_PHONE (default +212600000099). Log in with
// that number; in development the code is printed by the console sink. Everything goes through the same sync
// mutations as a phone, so every rule and audit event applies. Run `pnpm db:seed` first (strains, catalogue).
// The figures are made up to look plausible: DEMO ONLY, never a reference (no breeder curve, no vaccine schedule).

const phone = process.env.DEMO_PHONE ?? "+212600000099";
if (await db.user.findUnique({ where: { phoneNumber: phone } })) {
  console.log(`demo: ${phone} already exists, nothing to do`);
  process.exit(0);
}

const user = await db.user.create({ data: { phoneNumber: phone, name: "Démo", email: `${phone.slice(1)}@phone.invalid`, locale: "fr" } });
const org = await createOrganization(user.id, { name: "Élevage de démonstration", form: "individual", locale: "fr" });
if (!org.ok) throw new Error(org.error);

const today = farmDayOf(new Date());
const placedOn = addFarmDays(today, -21);
const day = (age: number): FarmDay => addFarmDays(placedOn, age);
const id = { farm: uuidv7(), h1: uuidv7(), h2: uuidv7(), supplier: uuidv7(), feed: uuidv7(), batch: uuidv7() };
const m = (type: string, payload: unknown) => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });

const days = Array.from({ length: 21 }, (_, age) => age + 1).map((age) =>
  m("flock.recordDay", {
    batchId: id.batch,
    day: day(age),
    changes: { dead: age % 4 === 0 ? 3 : 1, deathCause: "unknown", culled: 0, feed: { stockItemId: id.feed, grams: 60_000 + age * 22_000 }, waterMl: (110 + age * 40) * 1000, note: null },
  }),
);

const { results } = await push(
  org.value,
  [
    m("farm-registry.createFarm", { id: id.farm, name: "Ferme de démonstration", region: "Casablanca-Settat", province: "Settat", commune: "Ben Ahmed", gps: null, onssa: null }),
    m("farm-registry.createHouse", { id: id.h1, farmId: id.farm, name: "Bâtiment 1", areaM2: 1000, capacity: 10000, type: "closed" }),
    m("farm-registry.createHouse", { id: id.h2, farmId: id.farm, name: "Bâtiment 2", areaM2: 800, capacity: 8000, type: "closed" }),
    m("inventory.createSupplier", { id: id.supplier, name: "Provende du Centre", phone: null }),
    m("inventory.createStockItem", { id: id.feed, farmId: id.farm, productId: "feed-starter", kind: "feed", name: "Aliment démarrage", unit: "kg", lot: null, expiresOn: null }),
    m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: id.supplier, stockItemId: id.feed, day: placedOn, quantity: 20_000_000, unitPriceCentimes: "420", paidCentimes: "5000000", dueOn: day(30) }),
    m("flock.placeBatch", { id: id.batch, houseId: id.h1, strainId: "ross-308", placedOn, chicksPlaced: 8000, deadOnArrival: 12, hatchery: "Couvoir de démonstration", deliveryNote: "BL-DEMO", chickUnitPriceCentimes: "550", dayOldWeightGrams: 42 }),
    ...days,
    m("flock.recordWeighing", { id: uuidv7(), batchId: id.batch, day: day(7), sample: { totalGrams: 9_600, count: 50 } }),
    m("flock.recordWeighing", { id: uuidv7(), batchId: id.batch, day: day(14), sample: { totalGrams: 24_500, count: 50 } }),
  ],
  registry,
);

const refused = results.filter((r) => r.status !== "applied");
if (refused.length > 0) throw new Error(`demo: refused ${JSON.stringify(refused)}`);
console.log(`demo: ${results.length} writes applied. Log in with ${phone}.`);
await db.$disconnect();
