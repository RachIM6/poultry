import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { EGG_MUTATIONS as E, eggLots, type EggCollectionDto, type EggDrawDto, type EggGradingDto } from "@/modules/eggs/schema";
import { SALES_MUTATIONS as S, type SaleDto } from "@/modules/sales/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-17T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const counts = (normal: number) => ({ normal, cracked: 0, dirty: 0, doubleYolk: 0, floor: 0, broken: 0 });

describe("egg sales (SPEC-m3 V6)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), layers: uuidv7(), buyer: uuidv7() };
  const today = farmDayOf(new Date());
  const [older, newer] = [addFarmDays(today, -3), addFarmDays(today, -1)];
  const sale = (lines: object[], over: object = {}) =>
    m(S.recordEggSale, { id: uuidv7(), batchId: ids.layers, buyerId: ids.buyer, day: today, lines, paymentMethod: "credit", paidCentimes: "0", instrument: null, ...over });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.eggGrade.createMany({ data: ["s", "m", "l", "xl"].map((id, sortOrder) => ({ id, label: id.toUpperCase(), sortOrder })) }); // reference data (E3)
    await db.strain.create({ data: { id: "lohmann-brown", name: "Lohmann Brown", productionTypes: ["pullet", "layer"] } });
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "P1", areaM2: 1000, capacity: 6000, type: "closed" }),
        m("flock.placeBatch", { id: ids.layers, houseId: ids.house, species: "layer", strainId: "lohmann-brown", placedOn: addFarmDays(today, -10), chicksPlaced: 6000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 200 }),
        m(E.recordCollection, { id: uuidv7(), batchId: ids.layers, day: older, counts: counts(300), sample: null }),
        m(E.recordCollection, { id: uuidv7(), batchId: ids.layers, day: newer, counts: counts(600), sample: null }),
        m(E.gradeEggs, { id: uuidv7(), batchId: ids.layers, laidOn: older, grades: { m: 300 } }),
        m(E.gradeEggs, { id: uuidv7(), batchId: ids.layers, laidOn: newer, grades: { m: 600 } }),
        m(S.createBuyer, { id: ids.buyer, name: "Grossiste Al Wafa", phone: null, type: "trader" }),
      ),
    ).toEqual(Array(8).fill("applied"));
  });

  it("draws the oldest eggs first, prices them per tray and owes the amount", async () => {
    const sold = sale([{ item: "grade:m", eggs: 450, unitPriceCentimes: "3300" }]);
    const { id } = sold.payload as { id: string };
    expect(await statuses(a, sold)).toEqual(["applied"]);
    const changes = (await pull(a, 0, registry)).changes;
    const of = <T,>(e: string) => changes.filter((c) => c.entity === e).map((c) => c.data as T);
    expect(of<EggDrawDto>("eggDraw").map((d) => [d.laidOn, d.eggs])).toEqual([[older, 300], [newer, 150]]);
    expect(of<SaleDto>("sale").find((s) => s.id === id)).toMatchObject({ kind: "eggs", amountCentimes: "49500", lines: [{ eggs: 450, eggsPerTray: 30, amountCentimes: "49500" }] }); // 15 trays × 33,00
    const lots = eggLots({ collections: of<EggCollectionDto>("eggCollection"), gradings: of<EggGradingDto>("eggGrading"), discards: [], drawn: of<EggDrawDto>("eggDraw") });
    expect(lots.map((l) => [l.laidOn, l.eggs])).toEqual([[newer, 450]]);
    expect(await db.saleLine.count({ where: { saleId: id } })).toBe(1);
  });

  it("refuses eggs laid during an egg withdrawal until they are discarded, and a sale beyond the stock", async () => {
    // A treatment straight in health's table: its stock and medicine aren't the point here. Made-up days (MQ4).
    const item = await db.stockItem.create({ data: { id: uuidv7(), organizationId: a.organizationId, farmId: ids.farm, kind: "medicine", name: "M", unit: "ml" } });
    const date = (d: string) => new Date(`${d}T00:00:00Z`);
    await db.treatment.create({
      data: { id: uuidv7(), organizationId: a.organizationId, batchId: ids.layers, stockItemId: item.id, quantity: 1, dose: "d", startOn: date(newer), endOn: date(newer), reason: "r", prescriber: "p", withdrawalDays: 0, withdrawalEndsOn: date(newer), eggWithdrawalDays: 2, eggWithdrawalEndsOn: date(addFarmDays(newer, 2)), recordedBy: a.userId },
    });
    expect(await statuses(a, sale([{ item: "grade:m", eggs: 10, unitPriceCentimes: "3300" }]))).toEqual(["errors.EGGS_IN_WITHDRAWAL"]);
    expect(await statuses(a, m(E.discardEggs, { id: uuidv7(), batchId: ids.layers, laidOn: newer, item: "grade:m", eggs: 450, reason: "Délai d’attente" }))).toEqual(["applied"]);
    expect(await statuses(a, sale([{ item: "grade:m", eggs: 1, unitPriceCentimes: "3300" }]))).toEqual(["errors.NOT_ENOUGH_EGGS"]);
    expect(await db.eggDraw.count()).toBe(2); // nothing drawn by the refused sales
  });

  it("keeps money and egg sales to owners and managers of the organisation", async () => {
    const worker = { ...a, role: "worker" as const };
    expect(await statuses(worker, sale([{ item: "grade:m", eggs: 1, unitPriceCentimes: "3300" }]))).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(b, sale([{ item: "grade:m", eggs: 1, unitPriceCentimes: "3300" }]))).toEqual(["errors.NOT_FOUND"]);
    const seen = (await pull(worker, 0, registry)).changes.filter((c) => c.entity === "sale");
    expect(JSON.stringify(seen)).not.toMatch(/unitPriceCentimes|amountCentimes/);
  });
});
