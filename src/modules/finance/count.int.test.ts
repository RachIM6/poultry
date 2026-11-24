import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { saveYearEndCount, yearEndCount } from "@/modules/finance";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });

describe("year-end count (SPEC-finance FC3, T107)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), supplier: uuidv7(), feed: uuidv7(), vaccine: uuidv7() };

  beforeAll(async () => {
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a, b] = await twoTenants();
    const purchase = (stockItemId: string, quantity: number) =>
      m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId, day: "2026-09-01", quantity, unitPriceCentimes: "460", paidCentimes: "0", dueOn: null });
    const pushed = await push(
      a,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
        m("inventory.createStockItem", { id: ids.vaccine, farmId: ids.farm, productId: null, kind: "vaccine", name: "HB1", unit: "dose", lot: "L7", expiresOn: "2026-10-01" }),
        purchase(ids.feed, 4_000_000), // 4 t
        purchase(ids.vaccine, 1000),
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: "2026-09-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null }),
        m("flock.recordDay", { batchId: ids.batch, day: "2026-09-02", changes: { dead: 12, culled: 0, feed: { stockItemId: ids.feed, grams: 1_000_000 } } }),
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
  });

  const clock = fixedClock("2026-11-20T10:00:00Z");

  it("lists the farm's open batches and stock items on the year's last day, with no amount", async () => {
    const sheet = await yearEndCount(a, null, clock); // the current fiscal year by default
    if (!sheet.ok) throw new Error(sheet.error);
    expect(sheet.value).toMatchObject({ year: 2026, day: "2026-12-31" });
    expect(sheet.value.farms.map((f) => [f.name, f.lines.map((l) => [l.kind, l.id, l.book, l.counted])])).toEqual([
      [
        "Ferme Atlas",
        [
          ["batch", ids.batch, 988, null],
          ["stock", ids.feed, 3_000_000, null],
          ["stock", ids.vaccine, 1000, null],
        ],
      ],
    ]);
    expect(sheet.value.farms[0].lines[0]).toMatchObject({ houseName: "B1", species: "broiler" });
    expect(sheet.value.farms[0].lines[2]).toMatchObject({ lot: "L7", expiresOn: "2026-10-01", expired: true });
    expect(JSON.stringify(sheet.value, (_, v) => (typeof v === "bigint" ? String(v) : v))).not.toMatch(/centimes|price|amount|value/i);
    const before = await yearEndCount(a, 2025, clock); // the batch and the stock came later
    expect(before.ok && before.value.farms).toEqual([]);
  });

  it("saves the counted quantities once, changes them, audited; owner and manager only, each organisation its own", async () => {
    const counts = { [ids.batch]: "985", [ids.feed]: "2 950,5", [ids.vaccine]: "0" };
    const books = async () => [await db.stockMovement.count(), await db.dailyEntry.count(), await db.batch.count(), await db.stockItem.count()];
    const untouched = await books();

    expect(await saveYearEndCount({ ...a, role: "worker" }, { year: 2026, counts })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await saveYearEndCount({ ...a, role: "accountant" }, { year: 2026, counts })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await yearEndCount({ ...a, role: "worker" }, 2026)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await saveYearEndCount(a, { year: 2026, counts: { [ids.batch]: "12,5" } })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveYearEndCount(b, { year: 2026, counts })).toEqual({ ok: false, error: "INVALID_INPUT" }); // not on b's sheet

    expect(await saveYearEndCount({ ...a, role: "manager" }, { year: 2026, counts })).toEqual({ ok: true, value: 3 });
    expect(await saveYearEndCount(a, { year: 2026, counts })).toEqual({ ok: true, value: 0 }); // the same figures: nothing to write
    expect(await saveYearEndCount(a, { year: 2026, counts: { [ids.batch]: "988", [ids.vaccine]: "" } })).toEqual({ ok: true, value: 2 });

    const read = await yearEndCount({ ...a, role: "accountant" }, 2026); // the accountant reads (FCX1)
    if (!read.ok) throw new Error(read.error);
    expect(read.value.farms[0].lines.map((l) => [l.counted, l.gap])).toEqual([
      [988, 0],
      [2_950_500, -49_500],
      [null, null],
    ]);
    const trail = await db.auditEvent.findMany({ where: { organizationId: a.organizationId, entity: "YearEndCount" }, orderBy: { id: "asc" } }); // uuidv7: in order
    expect(trail.map((e) => [e.action, (e.before as { quantity: number } | null)?.quantity ?? null, (e.after as { quantity: number } | null)?.quantity ?? null])).toEqual([
      ["create", null, 985],
      ["create", null, 2_950_500],
      ["create", null, 0],
      ["update", 985, 988],
      ["delete", 0, null],
    ]);
    expect(await db.yearEndCount.count({ where: { organizationId: b.organizationId } })).toBe(0);
    expect(await books()).toEqual(untouched); // finance corrects nothing in inventory or flock (FC3)
  });
});
