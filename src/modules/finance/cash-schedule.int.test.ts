import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { cashForecast, postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-01T08:00:00+01:00" });

// F-Effects: the next weeks' cash from facts (SPEC-finance FN12, FN15's weekly cash need).
describe("cash schedule", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), buyer: uuidv7(), supplier: uuidv7(), feed: uuidv7() };
  const clock = fixedClock("2026-11-20T10:00:00Z");

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a, b] = await twoTenants();
    const sale = (paymentMethod: string, paidCentimes: string, instrument: { number: string; dueOn: string } | null) =>
      m("sales.recordSale", { id: uuidv7(), batchId: ids.batch, buyerId: ids.buyer, day: "2026-11-15", birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod, paidCentimes, instrument });
    const pushed = await push(
      a,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: "2026-10-01", chicksPlaced: 10000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null }),
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        sale("cash", "300000", null), // 3 000,00 DH in the cash box
        sale("cheque", "300000", { number: "CH-1", dueOn: "2026-11-25" }), // 3 000,00 DH to collect next week
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
        // 9 000,00 DH on credit, 1 000,00 paid at once, the rest due on 30 November
        m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: "2026-11-16", quantity: 2_000_000, unitPriceCentimes: "450", paidCentimes: "100000", dueOn: "2026-11-30" }),
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
    await postPending(a);
  });

  it("runs today's cash forward with the cheques to collect and the supplier dues", async () => {
    const f = await cashForecast(a, clock);
    if (!f.ok) throw new Error(f.error);
    expect(f.value.startCentimes).toBe(200_000n); // 3 000,00 received − 1 000,00 paid at once
    expect(f.value.weeks.slice(0, 2).map((w) => [w.from, w.inCentimes, w.outCentimes, w.afterCentimes])).toEqual([
      ["2026-11-20", 300_000n, 0n, 500_000n],
      ["2026-11-27", 0n, 800_000n, -300_000n],
    ]);
  });

  it("is for those who see money, and each organisation's own", async () => {
    expect(await cashForecast({ ...a, role: "worker" }, clock)).toEqual({ ok: false, error: "FORBIDDEN" });
    const other = await cashForecast(b, clock);
    expect(other.ok && other.value.weeks.every((w) => w.inCentimes === 0n && w.outCentimes === 0n)).toBe(true);
  });
});
