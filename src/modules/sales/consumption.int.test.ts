import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import type { EggDrawDto } from "@/modules/eggs/schema";
import type { SoldBirdsDto } from "@/modules/flock/schema";
import { SALES_MUTATIONS as S, type SaleDto } from "@/modules/sales/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-22T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const pulled = async <T,>(ctx: TenantContext, entity: string) => (await pull(ctx, 0, registry)).changes.filter((c) => c.entity === entity).map((c) => c.data as T);
const counts = (normal: number) => ({ normal, cracked: 0, dirty: 0, doubleYolk: 0, floor: 0, broken: 0 });

describe("home consumption on the sale forms (SPEC-finance FC7)", () => {
  let a: TenantContext, b: TenantContext, worker: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), layerHouse: uuidv7(), broilers: uuidv7(), layers: uuidv7(), buyer: uuidv7() };
  const today = farmDayOf(new Date());
  const consumption = (over: object = {}) =>
    m(S.recordConsumption, { id: uuidv7(), batchId: ids.broilers, day: today, takenBy: "employee", kind: "live", birds: 5, farmWeightGrams: 10_000, ...over });
  const sold = async () => (await pulled<SoldBirdsDto>(a, "soldBirds")).reduce((n, s) => n + s.birds, 0);

  beforeAll(async () => {
    [a, b] = await twoTenants();
    worker = { ...a, role: "worker" };
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    await db.strain.create({ data: { id: "lohmann-brown", name: "Lohmann Brown", productionTypes: ["pullet", "layer"] } });
    await db.eggGrade.createMany({ data: ["m", "l"].map((id, sortOrder) => ({ id, label: id.toUpperCase(), sortOrder })) });
    const [older, newer] = [addFarmDays(today, -3), addFarmDays(today, -1)];
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1200, capacity: 12000, type: "closed" }),
        m("farm-registry.createHouse", { id: ids.layerHouse, farmId: ids.farm, name: "P1", areaM2: 1000, capacity: 6000, type: "closed" }),
        m("flock.placeBatch", { id: ids.broilers, houseId: ids.house, strainId: "ross-308", placedOn: addFarmDays(today, -30), chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null }),
        m("flock.placeBatch", { id: ids.layers, houseId: ids.layerHouse, species: "layer", strainId: "lohmann-brown", placedOn: addFarmDays(today, -10), chicksPlaced: 6000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 200 }),
        m("eggs.recordCollection", { id: uuidv7(), batchId: ids.layers, day: older, counts: counts(300), sample: null }),
        m("eggs.recordCollection", { id: uuidv7(), batchId: ids.layers, day: newer, counts: counts(600), sample: null }),
        m("eggs.gradeEggs", { id: uuidv7(), batchId: ids.layers, laidOn: older, grades: { m: 300 } }),
        m("eggs.gradeEggs", { id: uuidv7(), batchId: ids.layers, laidOn: newer, grades: { m: 600 } }),
        m(S.createBuyer, { id: ids.buyer, name: "Abattoir Atlas", phone: null, type: "abattoir" }),
        // the last sales, whose prices a consumption takes (FQ21): 14,50 DH/kg, then 15,00; eggs 33,00 a tray of M
        m(S.recordSale, { id: uuidv7(), batchId: ids.broilers, buyerId: ids.buyer, day: addFarmDays(today, -2), birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1450", paymentMethod: "cash", paidCentimes: "0", instrument: null }),
        m(S.recordSale, { id: uuidv7(), batchId: ids.broilers, buyerId: ids.buyer, day: addFarmDays(today, -1), birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "0", instrument: null }),
        m(S.recordEggSale, { id: uuidv7(), batchId: ids.layers, buyerId: ids.buyer, day: newer, lines: [{ item: "grade:m", eggs: 60, unitPriceCentimes: "3300" }], paymentMethod: "cash", paidCentimes: "0", instrument: null }),
      ),
    ).toEqual(Array(13).fill("applied"));
  });

  it("is recorded once, lowers birds on hand, has no buyer or payment, and is valued at the last sale's price", async () => {
    const taken = consumption();
    const { id } = taken.payload as { id: string };
    expect(await statuses(a, taken)).toEqual(["applied"]);
    expect(await statuses(a, taken)).toEqual(["applied"]); // the same mutation synced again: its stored result
    expect(await statuses(a, consumption({ id }))).toEqual(["errors.ALREADY_EXISTS"]); // another mutation, same record
    expect(await db.sale.count({ where: { id } })).toBe(1);
    expect(await sold()).toBe(205); // B5: 200 sold, 5 taken home
    const s = (await pulled<SaleDto>(a, "sale")).find((x) => x.id === id);
    expect(s).toMatchObject({ buyerId: null, takenBy: "employee", kind: "live", birds: 5, farmWeightGrams: 10_000, pricePerKgCentimes: "1500", amountCentimes: "15000", paymentMethod: "none", paidCentimes: "0", instrument: null });
    // the owner's typed price wins over the prefill
    const typed = consumption({ takenBy: "associate", pricePerKgCentimes: "1200" });
    expect(await statuses(a, typed)).toEqual(["applied"]);
    expect(await db.sale.findUniqueOrThrow({ where: { id: (typed.payload as { id: string }).id } })).toMatchObject({ amountCentimes: 12_000n, buyerId: null, takenBy: "associate" });
  });

  it("is refused during a withdrawal, and beyond the birds on hand, writing nothing", async () => {
    const before = [await db.sale.count(), await sold()];
    expect(await statuses(a, consumption({ birds: 1000 }))).toEqual(["errors.MORE_BIRDS_THAN_ON_HAND"]);
    const item = await db.stockItem.create({ data: { id: uuidv7(), organizationId: a.organizationId, farmId: ids.farm, kind: "medicine", name: "M", unit: "ml" } });
    const date = (d: string) => new Date(`${d}T00:00:00Z`);
    await db.treatment.create({
      data: { id: uuidv7(), organizationId: a.organizationId, batchId: ids.broilers, stockItemId: item.id, quantity: 1, dose: "d", startOn: date(today), endOn: date(today), reason: "r", prescriber: "p", withdrawalDays: 3, withdrawalEndsOn: date(addFarmDays(today, 3)), recordedBy: a.userId },
    });
    expect(await statuses(a, consumption())).toEqual(["errors.WITHDRAWAL_IN_PROGRESS"]);
    expect(await statuses(a, consumption({ kind: "perHead", lines: [{ item: "bird", birds: 2 }], farmWeightGrams: null }))).toEqual(["errors.WITHDRAWAL_IN_PROGRESS"]);
    expect([await db.sale.count(), await sold()]).toEqual(before);
  });

  it("draws eggs oldest first, priced per tray of the same item as last sold", async () => {
    const taken = consumption({ batchId: ids.layers, kind: "eggs", takenBy: "exploitant", lines: [{ item: "grade:m", eggs: 270 }] });
    const { id } = taken.payload as { id: string };
    expect(await statuses(a, taken)).toEqual(["applied"]);
    const draws = (await pulled<EggDrawDto>(a, "eggDraw")).filter((d) => d.saleId === id);
    expect(draws.map((d) => d.eggs)).toEqual([240, 30]); // 300 laid first, 60 of them sold
    expect((await pulled<SaleDto>(a, "sale")).find((x) => x.id === id)).toMatchObject({ kind: "eggs", takenBy: "exploitant", amountCentimes: "29700", lines: [{ item: "grade:m", eggs: 270, eggsPerTray: 30, unitPriceCentimes: "3300" }] }); // 9 trays × 33,00
    expect(await statuses(a, consumption({ batchId: ids.layers, kind: "eggs", lines: [{ item: "grade:m", eggs: 1000 }] }))).toEqual(["errors.NOT_ENOUGH_EGGS"]);
  });

  it("lets a worker record the quantities; the server prices them and the worker's pull carries no price (I5)", async () => {
    await db.treatment.deleteMany({ where: { batchId: ids.broilers } });
    const taken = consumption({ birds: 2, farmWeightGrams: 4_000, pricePerKgCentimes: "1" }); // a price from a worker: ignored
    const { id } = taken.payload as { id: string };
    expect(await statuses(worker, taken)).toEqual(["applied"]);
    expect(await statuses(worker, m(S.recordSale, { id: uuidv7(), batchId: ids.broilers, buyerId: ids.buyer, day: today, birds: 1, farmWeightGrams: 2000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "0", instrument: null }))).toEqual(["errors.FORBIDDEN"]);
    expect((await db.sale.findUniqueOrThrow({ where: { id } })).amountCentimes).toBe(6000n); // 4 kg × 15,00, the last sale's
    const seen = (await pulled<SaleDto>(worker, "sale")).filter((s) => s.takenBy);
    expect(seen.find((s) => s.id === id)).toEqual({ id, batchId: ids.broilers, buyerId: null, day: today, birds: 2, farmWeightGrams: 4_000, buyerWeightGrams: null, kind: "live", takenBy: "employee" });
    expect(JSON.stringify(seen)).not.toMatch(/Centimes|paymentMethod|lines/);
  });

  it("stays in its organisation", async () => {
    expect(await statuses(b, consumption())).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(b, consumption({ batchId: ids.layers, kind: "eggs", lines: [{ item: "grade:m", eggs: 1 }] }))).toEqual(["errors.NOT_FOUND"]);
    expect(await pulled(b, "sale")).toEqual([]);
  });
});
