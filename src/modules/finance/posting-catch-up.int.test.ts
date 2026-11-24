import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { batchResults, officialStatements, postAllPending, postPending, readBooks, treasuryOverview } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant, twoTenants } from "@/test/tenant";

// The test seam: posting fails for these organisations, as when its transaction expires under load (P2028).
const failing = vi.hoisted(() => new Set<string>());
vi.mock("@/modules/finance/application/ledger", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/finance/application/ledger")>();
  return {
    ...original,
    postEntry: (...args: Parameters<typeof original.postEntry>) => {
      if (failing.has(args[1].organizationId)) throw new Error("Transaction already closed");
      return original.postEntry(...args);
    },
  };
});

const m = (type: string, payload: unknown) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-01T08:00:00+01:00" });

describe("postings catch up without a new push (SPEC-finance FN7, §9 \"Postings catch up\")", () => {
  let a: TenantContext, b: TenantContext;
  const items = new Map<string, { supplier: string; feed: string }>();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});

  async function setUp(ctx: TenantContext) {
    const ids = { farm: uuidv7(), supplier: uuidv7(), feed: uuidv7() };
    const done = await push(
      ctx,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
      ],
      registry,
    );
    expect(done.results.every((r) => r.status === "applied")).toBe(true);
    items.set(ctx.organizationId, { supplier: ids.supplier, feed: ids.feed });
  }

  /** A feed purchase of 9 000,00 DH, 3 000,00 paid cash, pushed without posting: its id. */
  async function purchase(ctx: TenantContext) {
    const id = uuidv7();
    const { supplier, feed } = items.get(ctx.organizationId)!;
    const p = { id, movementId: uuidv7(), supplierId: supplier, stockItemId: feed, day: "2026-03-02", quantity: 2_000_000, unitPriceCentimes: "450", paidCentimes: "300000", dueOn: null };
    expect((await push(ctx, [m("inventory.recordPurchase", p)], registry)).results[0].status).toBe("applied");
    return id;
  }
  const entriesOf = (sourceId: string) => db.journalEntry.findMany({ where: { sourceModule: "inventory", sourceId } });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [a, b] = await twoTenants();
    await setUp(a);
    await setUp(b);
  });

  afterEach(() => {
    failing.clear();
    errors.mockClear();
  });

  it("posts a failed posting at the scheduler's next run, and one organisation's failure holds no other back", async () => {
    const [pa, pb] = [await purchase(a), await purchase(b)];
    failing.add(a.organizationId);
    await expect(postPending(a)).rejects.toThrow(); // the push's posting fails: nothing posted, the cursor stays

    expect(await postAllPending()).toBe(1); // b's purchase; a fails again
    expect(await entriesOf(pa)).toHaveLength(0);
    expect(await entriesOf(pb)).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith("[finance] posting failed", a.organizationId, expect.any(Error));
    expect(errors).toHaveBeenCalledWith("[finance] posting failed for 1 of 2 organisations");

    failing.clear(); // no new push from anyone
    expect(await postAllPending()).toBe(1);
    expect(await entriesOf(pa)).toHaveLength(1);
    expect(await postAllPending()).toBe(0); // nothing pending: no organisation is run
  });

  it("posts what is pending before a read of the books shows them", async () => {
    const id = await purchase(a);
    const books = await readBooks(a, "2026-03");
    const [entry] = await entriesOf(id);
    expect(books.ok && books.value.cashBook.rows.filter((r) => r.entryId === entry.id).map((r) => r.expense)).toEqual([300_000n]);

    // /treasury, /results and the statements read the books too
    for (const read of [() => treasuryOverview(a, "2026-03"), () => batchResults(a), () => officialStatements(a, 2026)]) {
      const next = await purchase(a);
      expect((await read()).ok).toBe(true);
      expect(await entriesOf(next)).toHaveLength(1);
    }
  });

  it("still shows the books when the posting fails, with what is posted, and logs it", async () => {
    const id = await purchase(a);
    failing.add(a.organizationId);
    const books = await readBooks(a, "2026-03");
    expect(books.ok).toBe(true);
    expect(await entriesOf(id)).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith("[finance] posting failed", expect.any(Error));

    failing.clear();
    await readBooks(a, "2026-03");
    expect(await entriesOf(id)).toHaveLength(1);
  });

  it("posts each source once when the push, a read and the scheduler run at the same time", async () => {
    const c = await tenant("+212600000003"); // no cursor yet: both runs create it
    await setUp(c);
    const ids = [await purchase(c), await purchase(c), await purchase(c)];
    await Promise.all([postPending(c), postPending(c), readBooks(c, "2026-03"), postAllPending()]);
    for (const id of ids) expect(await entriesOf(id)).toHaveLength(1);
    expect(await db.journalEntry.count({ where: { organizationId: c.organizationId } })).toBe(3); // no reversal either
    expect(errors).not.toHaveBeenCalled();
  });
});
