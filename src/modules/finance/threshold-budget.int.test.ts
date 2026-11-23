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

// SPEC-finance FN17 + §9 FQ32: a budget linked to a batch plans only what that batch hasn't sold yet, while it is open.
describe("5 M DH tracker: budgets linked to a batch (FN17, FQ32)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), h1: uuidv7(), h2: uuidv7(), open: uuidv7(), closed: uuidv7(), buyer: uuidv7() };
  const sale = (batchId: string, birds: number, grams: number) =>
    m("sales.recordSale", { id: uuidv7(), batchId, buyerId: ids.buyer, day: "2026-03-01", birds, farmWeightGrams: grams, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "credit", paidCentimes: "0", instrument: null });
  // planned sales: plannedGrams × 15,00 DH/kg
  const budget = (name: string, plannedGrams: string, batchId: string | null) => ({ id: uuidv7(), name, basedOn: null, batchId, chicks: "1000", chickPriceCentimes: "550", feedGrams: "0", feedPricePerKgCentimes: "460", otherCostCentimes: "0", plannedGrams, salePricePerKgCentimes: "1500" });
  const saved = async (ctx: TenantContext, input: unknown, createdAt: string) => {
    const r = await saveBudget(ctx, input);
    if (!r.ok) throw new Error(r.error);
    await db.budget.update({ where: { id: r.value }, data: { createdAt: new Date(createdAt) } });
  };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a, b] = await twoTenants();
    const place = (id: string, houseId: string, chicksPlaced: number) =>
      m("flock.placeBatch", { id, houseId, strainId: "ross-308", placedOn: "2026-01-15", chicksPlaced, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null });
    const pushed = await push(
      a,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.h1, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("farm-registry.createHouse", { id: ids.h2, farmId: ids.farm, name: "B2", areaM2: 1000, capacity: 10000, type: "closed" }),
        place(ids.open, ids.h1, 10000),
        place(ids.closed, ids.h2, 1000),
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        sale(ids.open, 1000, 20_000_000), // 20 000 kg × 15,00 = 300 000,00 booked; the batch stays open
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
    await saved(a, budget("Bande B2", "4000000", ids.closed), "2026-01-10T08:00:00Z"); // 60 000,00, linked while open…
    const last = await push(a, [sale(ids.closed, 1000, 2_000_000)], registry); // …then its last birds: 30 000,00 booked, it closes
    expect(last.results.map((r) => r.status)).toEqual(["applied"]);
    await postPending(a);
    expect((await db.batch.findUniqueOrThrow({ where: { id: ids.closed } })).status).toBe("closed");

    // the open batch's budgets, both saved before the fiscal year: only the latest counts, less what it has sold
    await saved(a, budget("Bande B1, v1", "46000000", ids.open), "2025-11-01T08:00:00Z"); // 690 000,00: replaced by v2
    await saved(a, budget("Bande B1, v2", "40000000", ids.open), "2025-12-15T08:00:00Z"); // 600 000,00 − 300 000,00 sold
    await saved(a, budget("Sans bande", "3000000", null), "2026-10-01T08:00:00Z"); // 45 000,00: saved this fiscal year, counts
    await saved(a, budget("Sans bande, 2025", "3000000", null), "2025-10-01T08:00:00Z"); // saved last year: doesn't count
  });

  it("counts a linked budget's unsold part while its batch is open, nothing once closed, unlinked budgets by save date", async () => {
    const t = await thresholdTracker(a, fixedClock("2026-11-20T10:00:00Z"));
    if (!t.ok || !t.value) throw new Error("no tracker");
    expect(t.value).toMatchObject({ bookedCentimes: 33_000_000n, plannedCentimes: 34_500_000n }); // 300 000 + 0 (closed) + 45 000
  });

  it("links a budget only to an open batch of the caller's organisation", async () => {
    expect(await saveBudget(b, budget("Vol", "46000000", ids.open))).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveBudget(a, budget("Fermée", "46000000", ids.closed))).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveBudget(a, budget("Inconnue", "46000000", uuidv7()))).toEqual({ ok: false, error: "INVALID_INPUT" });
    const other = await thresholdTracker(b, fixedClock("2026-11-20T10:00:00Z"));
    expect(other.ok && other.value).toMatchObject({ bookedCentimes: 0n, plannedCentimes: 0n });
  });
});
