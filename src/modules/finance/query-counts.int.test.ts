import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { batchResults, postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

// Every SQL statement Prisma sends goes through the pg driver its adapter loads: count the calls there.
const require = createRequire(import.meta.url);
const pg = createRequire(require.resolve("@prisma/adapter-pg"))("pg") as typeof import("pg");
async function queriesOf(run: () => Promise<unknown>) {
  const spy = vi.spyOn(pg.Client.prototype, "query");
  try {
    await run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

const m = (type: string, payload: unknown) => ({ id: uuidv7(), type, payload, createdAt: "2026-10-02T08:00:00+01:00" });

/** `n` batches, each in its own house, each having eaten feed from one stock item bought once. */
async function farmWith(ctx: TenantContext, n: number) {
  const farm = uuidv7(), supplier = uuidv7(), feed = uuidv7();
  const houses = Array.from({ length: n }, () => ({ house: uuidv7(), batch: uuidv7() }));
  const done = await push(
    ctx,
    [
      m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m("inventory.createSupplier", { id: supplier, name: "Alf", phone: null }),
      m("inventory.createStockItem", { id: feed, farmId: farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
      m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: supplier, stockItemId: feed, day: "2026-10-01", quantity: 10_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null }),
      ...houses.flatMap(({ house, batch }, i) => [
        m("farm-registry.createHouse", { id: house, farmId: farm, name: `B${i + 1}`, areaM2: 1000, capacity: 10000, type: "closed" }),
        m("flock.placeBatch", { id: batch, houseId: house, strainId: "ross-308", placedOn: "2026-10-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null }),
        m("flock.recordDay", { batchId: batch, day: "2026-10-02", changes: { dead: 0, culled: 0, feed: { stockItemId: feed, grams: 50_000 } } }),
      ]),
    ],
    registry,
  );
  expect(done.results.every((r) => r.status === "applied")).toBe(true);
  await postPending(ctx); // the purchase and the placements: nothing pending afterwards
  return houses.map((h) => h.batch);
}

describe("server read paths issue a bounded number of queries (performance audit H1, M2)", () => {
  let small: TenantContext, large: TenantContext;
  let batches: string[];

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [small, large] = await twoTenants();
    await farmWith(small, 3);
    batches = await farmWith(large, 30);
  }, 120_000); // 30 batches pushed and posted

  it("FN13's batch results: the same few queries for 3 batches as for 30", async () => {
    const results = async (ctx: TenantContext, n: number) => {
      const r = await batchResults(ctx);
      if (!r.ok) throw new Error(r.error);
      expect(r.value).toHaveLength(n);
      expect(r.value.every((x) => x.costs.consumption === 22_500n)).toBe(true); // 50 kg × 4,50 DH each
    };
    const forThree = await queriesOf(() => results(small, 3));
    const forThirty = await queriesOf(() => results(large, 30));
    expect(forThree).toBeGreaterThan(0); // the counter sees the queries
    expect(forThirty).toBe(forThree);
    expect(forThirty).toBeLessThanOrEqual(15);
  });

  it("the posting run after a push of one daily entry, with nothing to post, is one query", async () => {
    const entry = m("flock.recordDay", { batchId: batches[0], day: "2026-10-03", changes: { dead: 1, culled: 0 } });
    expect((await push(large, [entry], registry)).results[0].status).toBe("applied");
    let posted = -1;
    expect(await queriesOf(async () => void (posted = await postPending(large)))).toBeLessThanOrEqual(2);
    expect(posted).toBe(0);
  });

  it("a batch's closing alone is pending, so the posting run still freezes its shares (FN14)", async () => {
    const close = m("flock.closeBatch", { batchId: batches[1], day: "2026-10-04", reason: "Test" });
    expect((await push(large, [close], registry)).results[0].status).toBe("applied");
    await postPending(large);
    expect(await db.frozenBatch.count({ where: { batchId: batches[1] } })).toBe(1);
  });
});
