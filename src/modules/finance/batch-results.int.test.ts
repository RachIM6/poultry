import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { batchResults, postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("batch result and shared-cost allocation (SPEC-finance FN13, FN14, T34)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), h1: uuidv7(), h2: uuidv7(), batchA: uuidv7(), batchB: uuidv7(), supplier: uuidv7(), feed: uuidv7(), buyer: uuidv7() };
  const expense = (amount: string, serviceMonth: string | null, batchId: string | null = null, category = "electricity") =>
    m("finance.recordExpense", { id: uuidv7(), day: "2026-11-05", category, amountCentimes: amount, paidFrom: "credit", treasuryId: null, note: null, batchId, serviceMonth });
  const result = async (ctx: TenantContext, id: string) => {
    const r = await batchResults(ctx);
    if (!r.ok) throw new Error(r.error);
    return r.value.find((x) => x.id === id)!;
  };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a, b] = await twoTenants();
    const place = (id: string, houseId: string, placedOn: string, chicks: number) =>
      m("flock.placeBatch", { id, houseId, strainId: "ross-308", placedOn, chicksPlaced: chicks, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null });
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.h1, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("farm-registry.createHouse", { id: ids.h2, farmId: ids.farm, name: "B2", areaM2: 800, capacity: 8000, type: "closed" }),
        place(ids.batchA, ids.h1, "2026-09-20", 1000), // all of October: 31 × 1 000 = 31 000 bird-days
        place(ids.batchB, ids.h2, "2026-10-16", 500), // 16–31 October: 16 × 500 = 8 000 bird-days
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
      ),
    ).toEqual(Array(8).fill("applied"));
  });

  it("splits an electricity bill paid in November for October across the batches present in October, by bird-days", async () => {
    expect(await statuses(a, expense("390000", "2026-10"))).toEqual(["applied"]); // 3 900,00
    expect((await result(a, ids.batchA)).costs.allocated).toBe(310_000n); // 31 000 / 39 000
    expect((await result(a, ids.batchB)).costs.allocated).toBe(80_000n); // 8 000 / 39 000
    expect(await statuses(a, expense("10000", "2026-08"))).toEqual(["applied"]); // no batch present in August: not split
    expect((await result(a, ids.batchB)).costs.allocated).toBe(80_000n);
  });

  it("counts what a batch consumed, never what was bought for it", async () => {
    expect(
      await statuses(
        a,
        m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: "2026-10-16", quantity: 1_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null }),
        m("flock.recordDay", { batchId: ids.batchB, day: "2026-10-17", changes: { dead: 0, culled: 0, feed: { stockItemId: ids.feed, grams: 85_000 } } }),
      ),
    ).toEqual(["applied", "applied"]);
    expect((await result(a, ids.batchB)).costs.consumption).toBe(38_250n); // 85 kg × 4,50 DH, not the 4 500,00 bought
    // FN13's comparison: the feed eaten at 4,50 DH/kg; nothing sold yet, so no FCR nor price
    expect((await result(a, ids.batchB)).comparison).toEqual({ lostPermille: 0n, fcrMilli: null, feedPricePerKgCentimes: 450n, pricePerKgCentimes: null });
    expect(await statuses(a, expense("20000", null, ids.batchB, "vet_fees"))).toEqual(["applied"]); // a direct charge of B
    expect((await result(a, ids.batchB)).costs.direct).toBe(20_000n);
    expect(await statuses(b, expense("1", null, ids.batchB))).toEqual(["errors.NOT_FOUND"]); // a's batch
  });

  it("freezes a closed batch's allocation: later expenses and key changes leave it alone, parts still sum", async () => {
    // A sells its 1 000 birds (2 000 kg × 15,00 = 30 000,00) on 2 Nov and closes; the pipeline freezes it.
    expect(
      await statuses(a, m("sales.recordSale", { id: uuidv7(), batchId: ids.batchA, buyerId: ids.buyer, day: "2026-11-02", birds: 1000, farmWeightGrams: 2_000_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "3000000", instrument: null })),
    ).toEqual(["applied"]);
    await postPending(a);
    const closed = await result(a, ids.batchA);
    expect(closed).toMatchObject({ frozen: true, closedOn: "2026-11-02", costs: { allocated: 310_000n } });

    // B loses birds in October (the key moves) and November's water is shared: A keeps 3 100,00.
    await statuses(a, m("flock.recordDay", { batchId: ids.batchB, day: "2026-10-20", changes: { dead: 100, culled: 0 } }), expense("100000", "2026-11", null, "water"));
    expect((await result(a, ids.batchA)).costs.allocated).toBe(310_000n);
    expect((await result(a, ids.batchB)).costs.allocated).toBe(80_000n + 100_000n); // October's rest + all of November's water

    // FN13: A's result. Cost 5 500,00 of chicks + 3 100,00 allocated = 8 600,00; margin 21 400,00 on 2 000 kg.
    expect(await result(a, ids.batchA)).toMatchObject({ salesCentimes: 3_000_000n, costCentimes: 860_000n, marginCentimes: 2_140_000n, costPerKgCentimes: 430n, marginPerKgCentimes: 1070n, marginPermille: 713n });
    expect((await result(a, ids.batchA)).comparison.pricePerKgCentimes).toBe(1500n); // 30 000,00 DH for 2 000 kg
    expect((await result(a, ids.batchB)).comparison.lostPermille).toBe(200n); // 100 of 500 dead: 20 %
  });

  it("is for owners and managers only", async () => {
    expect(await batchResults({ ...a, role: "worker" })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect((await batchResults(b)).ok && (await batchResults(b)).ok).toBe(true);
    const r = await batchResults(b);
    expect(r.ok && r.value).toEqual([]); // nothing of a's
  });
});

