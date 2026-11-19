import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { postPending, saveBudget, thresholdTracker } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-10T08:00:00+01:00" });

describe("5 M DH tracker (SPEC-finance FN17, T37)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), buyer: uuidv7() };
  const sale = (day: string, grams: number) =>
    m("sales.recordSale", { id: uuidv7(), batchId: ids.batch, buyerId: ids.buyer, day, birds: 1000, farmWeightGrams: grams, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "credit", paidCentimes: "0", instrument: null });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a, b] = await twoTenants();
    const pushed = await push(
      a,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: "2025-01-01", chicksPlaced: 10000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null }),
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        sale("2025-06-01", 340_000_000), // 340 000 kg × 15,00 = 5 100 000,00 in 2025: over the threshold
        sale("2026-03-01", 284_030_000), // 284 030 kg × 15,00 = 4 260 450,00 in 2026
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
    await postPending(a);
    // a planned batch: 46 000 kg at 15,00 = 690 000,00 of planned sales
    const budget = { name: "Prochaine bande", basedOn: null, chicks: "20000", chickPriceCentimes: "550", feedGrams: "80000000", feedPricePerKgCentimes: "460", otherCostCentimes: "0", plannedGrams: "46000000", salePricePerKgCentimes: "1500" };
    expect(await saveBudget(a, budget)).toMatchObject({ ok: true });
    await db.budget.updateMany({ data: { createdAt: new Date("2026-10-01T08:00:00Z") } }); // saved during the 2026 fiscal year, whatever today is
  });

  it("adds this year's booked sales and the budgets' planned sales: 4 260 450 + 690 000 → 99 %, alert", async () => {
    const t = await thresholdTracker(a, fixedClock("2026-11-20T10:00:00Z"));
    if (!t.ok || !t.value) throw new Error("no tracker");
    expect(t.value).toMatchObject({
      fiscalYear: { from: "2026-01-01", to: "2026-12-31" },
      bookedCentimes: 426_045_000n,
      plannedCentimes: 69_000_000n,
      usage: { totalCentimes: 495_045_000n, percent: 99n, alert: true, over: false },
    });
    expect(t.value.history).toEqual([
      { from: "2025-01-01", to: "2025-12-31", bookedCentimes: 510_000_000n, over: true },
      { from: "2024-01-01", to: "2024-12-31", bookedCentimes: 0n, over: false },
      { from: "2023-01-01", to: "2023-12-31", bookedCentimes: 0n, over: false },
    ]);
  });

  it("has no threshold before the configured one, and is for owners and managers only", async () => {
    expect(await thresholdTracker(a, fixedClock("2025-06-01T10:00:00Z"))).toEqual({ ok: true, value: null });
    expect(await thresholdTracker({ ...a, role: "worker" })).toEqual({ ok: false, error: "FORBIDDEN" });
    const other = await thresholdTracker(b, fixedClock("2026-11-20T10:00:00Z"));
    expect(other.ok && other.value?.bookedCentimes).toBe(0n);
  });
});
