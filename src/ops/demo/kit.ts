import { v7 as uuidv7 } from "uuid";
import { registry } from "@/app/api/sync/registry";
import { addFarmDays, farmDayOf, farmInstant, type FarmDay } from "@/lib/kernel/farm-day";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { purchaseAmount } from "@/modules/inventory/shared";

// The demo seed's helpers (prisma/demo.ts, T26). DEMO ONLY: every name and figure is made up (ADR-016).

export const today = farmDayOf(new Date());
export const ago = (n: number): FarmDay => addFarmDays(today, -n);
/** An instant on the farm clock (Africa/Casablanca: the zone database gives that day's offset). */
export const at = (day: FarmDay, time: string) => farmInstant(day, Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))).toISOString();
export const m = (type: string, payload: unknown) => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
export const dh = (x: number) => String(Math.round(x * 100)); // DH → integer centimes
export const saleCentimes = (grams: number, perKg: number) => (BigInt(grams) * BigInt(perKg) * 2n + 1000n) / 2000n; // sales' saleAmount, half up
export const tonnes = (grams: number) => Math.ceil(grams / 1_000_000) * 1_000_000;
export const id = uuidv7;

export type Mutation = ReturnType<typeof m>;
export type Feed = { starter: string; grower: string; finisher: string };

type Rearing = {
  feed: (age: number) => string; // the stock item eaten at this age
  gramsPerBird: (age: number) => number; // made-up intake, not a breeder table
  deadPerMille?: (age: number) => number;
  sold?: Record<number, number>; // birds taken out after that day's entry
  skip?: number[]; // days of age left without an entry (a forgotten day)
};

/** A batch's daily entries from placement to `lastAge`, with the feed each item gave. */
export function rear(batchId: string, placedOn: FarmDay, alive: number, lastAge: number, r: Rearing) {
  const entries: Mutation[] = [];
  const used: Record<string, number> = {};
  const placed = alive;
  const perMille = r.deadPerMille ?? ((age) => (age <= 3 ? 1.75 : age <= 7 ? 0.9 : age % 9 === 0 ? 1.1 : 0.4));
  for (let age = 0; age <= lastAge; age++) {
    const dead = Math.round((placed * perMille(age)) / 1000);
    const culled = age % 10 === 5 ? Math.round(placed / 2000) : 0;
    alive -= dead + culled;
    const item = r.feed(age);
    const grams = alive * r.gramsPerBird(age);
    used[item] = (used[item] ?? 0) + grams;
    if (!r.skip?.includes(age)) {
      const changes = { dead, deathCause: age % 9 === 0 ? "heat" : "unknown", culled, feed: { stockItemId: item, grams }, waterMl: Math.round(grams * 1.8), note: null };
      entries.push(m("flock.recordDay", { batchId, day: addFarmDays(placedOn, age), changes }));
    } else {
      used[item] -= grams; // nothing eaten on paper that day
      alive += dead + culled;
    }
    alive -= r.sold?.[age] ?? 0;
  }
  return { entries, alive, used };
}

/** A broiler batch: three feeds by phase, the intake rising with age. */
export const raise = (batchId: string, placedOn: FarmDay, alive: number, lastAge: number, feed: Feed, sold: Record<number, number> = {}, skip: number[] = []) =>
  rear(batchId, placedOn, alive, lastAge, { feed: (age) => (age <= 10 ? feed.starter : age <= 24 ? feed.grower : feed.finisher), gramsPerBird: (age) => Math.round(10 + 4.6 * age), sold, skip });

export const weighings = (batchId: string, placedOn: FarmDay, grams: [age: number, average: number][]) =>
  grams.map(([age, avg]) => m("flock.recordWeighing", { id: uuidv7(), batchId, day: addFarmDays(placedOn, age), sample: { totalGrams: avg * 50, count: 50 } }));

export const place = (batchId: string, houseId: string, placedOn: FarmDay, chicksPlaced: number, deliveryNote: string, extra: object = {}) =>
  m("flock.placeBatch", { id: batchId, houseId, strainId: "ross-308", placedOn, chicksPlaced, deadOnArrival: Math.round(chicksPlaced * 0.0015), hatchery: "Couvoir Démo", deliveryNote, chickUnitPriceCentimes: "550", dayOldWeightGrams: 42, ...extra });

type Paid = "all" | "none" | bigint;
/** A purchase, its total computed as the app does (per kg, per ml, per dose…). */
export const purchase = (supplierId: string, stockItemId: string, unit: "kg" | "ml" | "dose" | "unit", day: FarmDay, quantity: number, unitPriceCentimes: string, paid: Paid, paidMethod = "transfer", dueOn: FarmDay | null = null, vatCentimes = "0") => {
  const total = purchaseAmount(quantity, unit, BigInt(unitPriceCentimes));
  const paidCentimes = paid === "all" ? total : paid === "none" ? 0n : paid;
  return m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId, stockItemId, day, quantity, unitPriceCentimes, paidCentimes: String(paidCentimes), paidMethod, dueOn, vatCentimes });
};

/** A live-bird sale by the kg; the buyer's scale reads 15 g a bird less. */
export const sale = (batchId: string, buyerId: string, day: FarmDay, birds: number, avgGrams: number, perKg: number, paymentMethod: string, paid: "all" | "none", instrument: { number: string; dueOn: FarmDay } | null = null, saleId = uuidv7()) => {
  const farmWeightGrams = birds * avgGrams;
  const paidCentimes = paid === "all" ? String(saleCentimes(farmWeightGrams, perKg)) : "0";
  return m("sales.recordSale", { id: saleId, batchId, buyerId, day, birds, farmWeightGrams, buyerWeightGrams: farmWeightGrams - birds * 15, pricePerKgCentimes: String(perKg), paymentMethod, paidCentimes, instrument });
};

/** Pushes the writes as a phone would (the same sync mutations, rules and audit); throws on the first refusal. */
export async function apply(ctx: TenantContext, label: string, mutations: Mutation[]) {
  const { results } = await push(ctx, mutations, registry);
  const refused = results.filter((r) => r.status !== "applied");
  if (refused.length > 0 || results.length !== mutations.length) {
    const why = refused.map((r) => ({ ...r, type: mutations.find((x) => x.id === r.id)?.type }));
    throw new Error(`demo (${label}): ${results.length}/${mutations.length} answered, refused ${JSON.stringify(why)}`);
  }
  return results.length;
}

export const must = <T extends { ok: boolean }>(what: string, r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`demo: ${what} ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};
