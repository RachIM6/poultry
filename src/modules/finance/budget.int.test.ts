import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { budgetBases, budgetOf, listBudgets, saveBudget } from "@/modules/finance";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });

describe("budget from a closed batch (SPEC-finance FN15, T35)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), supplier: uuidv7(), feed: uuidv7(), vaccine: uuidv7(), buyer: uuidv7() };

  beforeAll(async () => {
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a, b] = await twoTenants();
    const purchase = (stockItemId: string, quantity: number, price: string) =>
      m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId, day: "2026-09-01", quantity, unitPriceCentimes: price, paidCentimes: "0", dueOn: null });
    const pushed = await push(
      a,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
        purchase(ids.feed, 4_000_000, "460"), // 4 t at 4,60 DH/kg
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: "2026-09-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null }),
        m("flock.recordDay", { batchId: ids.batch, day: "2026-09-02", changes: { dead: 0, culled: 0, feed: { stockItemId: ids.feed, grams: 3_000_000 } } }), // 3 t eaten
        m("flock.recordBatchCost", { id: uuidv7(), batchId: ids.batch, day: "2026-09-10", label: "Électricité", amountCentimes: "50000" }),
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        // all 1 000 birds, 2 000 kg at 14,00 DH/kg = 28 000,00: the batch closes
        m("sales.recordSale", { id: uuidv7(), batchId: ids.batch, buyerId: ids.buyer, day: "2026-10-15", birds: 1000, farmWeightGrams: 2_000_000, buyerWeightGrams: null, pricePerKgCentimes: "1400", paymentMethod: "cash", paidCentimes: "2800000", instrument: null }),
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
  });

  it("turns a closed batch into what-if inputs, with the feed apart", async () => {
    const bases = await budgetBases(a);
    if (!bases.ok) throw new Error(bases.error);
    expect(bases.value.map((x) => x.inputs)).toEqual([
      {
        chicks: 1000n,
        chickPriceCentimes: 550n,
        feedGrams: 3_000_000n,
        feedPricePerKgCentimes: 460n,
        otherCostCentimes: 50_000n, // the electricity of T24's other costs
        plannedGrams: 2_000_000n,
        salePricePerKgCentimes: 1400n,
      },
    ]);
    // The same batch's actual figures: 5 500,00 + 13 800,00 + 500,00 = 19 800,00; break-even 9,90 DH/kg.
    expect(budgetOf(bases.value[0].inputs)).toMatchObject({ plannedCostCentimes: 1_980_000n, breakEvenPerKgCentimes: 990n, plannedMarginCentimes: 820_000n });
  });

  it("saves a budget for the owner and the manager only, each organisation its own", async () => {
    const form = { name: "Bande de janvier", basedOn: ids.batch, chicks: "1200", chickPriceCentimes: "600", feedGrams: "3600000", feedPricePerKgCentimes: "480", otherCostCentimes: "60000", plannedGrams: "2400000", salePricePerKgCentimes: "1450" };
    expect(await saveBudget({ ...a, role: "worker" }, form)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await saveBudget(a, { ...form, chicks: "-3" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveBudget({ ...a, role: "manager" }, form)).toMatchObject({ ok: true });
    const saved = await listBudgets(a);
    expect(saved.ok && saved.value.map((s) => [s.name, s.inputs.feedPricePerKgCentimes])).toEqual([["Bande de janvier", 480n]]);
    const other = await listBudgets(b);
    expect(other.ok && other.value).toEqual([]);
    expect(await budgetBases({ ...a, role: "worker" })).toEqual({ ok: false, error: "FORBIDDEN" });
  });
});
