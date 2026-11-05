import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmRegistrySync } from "@/modules/farm-registry";
import { FARM_MUTATIONS } from "@/modules/farm-registry/schema";
import { inventorySync as registry, stockOnHand, supplierBalances } from "@/modules/inventory";
import { INVENTORY_MUTATIONS as M, type MovementDto, type PurchaseDto } from "@/modules/inventory/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const farmFields = { region: "Casablanca-Settat", province: "Settat", commune: "Ben Ahmed", gps: null, onssa: null };

describe("stock ledger, purchases and supplier credit (SPEC S1–S3, I5)", () => {
  let a: TenantContext, b: TenantContext;
  const [farmA, farmB, supplier, starter, vaccine] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await push(a, [m(FARM_MUTATIONS.createFarm, { id: farmA, name: "A", ...farmFields })], farmRegistrySync);
    await push(b, [m(FARM_MUTATIONS.createFarm, { id: farmB, name: "B", ...farmFields })], farmRegistrySync);
    await db.product.create({ data: { id: "feed-starter", kind: "feed", nameFr: "Aliment démarrage", nameAr: "علف البداية" } });
    expect(
      await statuses(a, [
        m(M.createSupplier, { id: supplier, name: "Alf Sahel", phone: "" }),
        m(M.createStockItem, { id: starter, farmId: farmA, productId: "feed-starter", kind: "feed", name: "Démarrage", unit: "kg", lot: "", expiresOn: null }),
        m(M.createStockItem, { id: vaccine, farmId: farmA, productId: null, kind: "vaccine", name: "Gumboro", unit: "dose", lot: "L2611", expiresOn: "2027-01-31" }),
      ]),
    ).toEqual(["applied", "applied", "applied"]);
  });

  it("a purchase adds stock; the unpaid part is supplier credit; a correction is a movement with a reason", async () => {
    const purchase = { supplierId: supplier, stockItemId: starter, day: "2026-11-05", quantity: 2_000_000, unitPriceCentimes: "450" };
    expect(
      await statuses(a, [
        m(M.recordPurchase, { id: uuidv7(), movementId: uuidv7(), ...purchase, paidCentimes: "300000", dueOn: "2026-12-15" }),
        m(M.recordPurchase, { id: uuidv7(), movementId: uuidv7(), ...purchase, quantity: 1_000_000, paidCentimes: "0", dueOn: null }),
        m(M.adjustStock, { id: uuidv7(), stockItemId: starter, day: "2026-11-06", quantity: -25_000, reason: "Sac déchiré" }),
      ]),
    ).toEqual(["applied", "applied", "applied"]);

    const changes = (await pull(a, 0, registry)).changes;
    const movements = changes.filter((c) => c.entity === "movement").map((c) => c.data as MovementDto);
    const purchases = changes.filter((c) => c.entity === "purchase").map((c) => c.data as PurchaseDto);
    expect(stockOnHand(movements).get(starter)).toBe(2_975_000); // 3 t bought − 25 kg
    const balances = supplierBalances(purchases.map((p) => ({ supplierId: p.supplierId, amountCentimes: BigInt(p.amountCentimes!), paidCentimes: BigInt(p.paidCentimes!) })));
    expect(balances.get(supplier)).toBe(1_050_000n); // 9 000 − 3 000 + 4 500 DH
    expect(await db.purchase.aggregate({ _sum: { amountCentimes: true } })).toEqual({ _sum: { amountCentimes: 1_350_000n } });
  });

  it("refuses what the rules forbid, before writing anything", async () => {
    const buy = { id: uuidv7(), movementId: uuidv7(), supplierId: supplier, stockItemId: starter, day: "2026-11-05", quantity: 1_000, unitPriceCentimes: "450" };
    expect(
      await statuses(a, [
        m(M.recordPurchase, { ...buy, paidCentimes: "451", dueOn: null }), // 1 kg × 4,50 = 4,50 DH
        m(M.recordPurchase, { ...buy, id: uuidv7(), movementId: uuidv7(), paidCentimes: "450", dueOn: "2026-12-01" }),
        m(M.adjustStock, { id: uuidv7(), stockItemId: starter, day: "2026-11-06", quantity: 0, reason: "x" }),
        m(M.createStockItem, { id: uuidv7(), farmId: farmA, productId: null, kind: "medicine", name: "Enro", unit: "ml", lot: "", expiresOn: null }),
        m(M.createStockItem, { id: uuidv7(), farmId: farmA, productId: "no-such-product", kind: "feed", name: "X", unit: "kg", lot: null, expiresOn: null }),
      ]),
    ).toEqual(["errors.PAID_MORE_THAN_AMOUNT", "errors.DUE_DATE_WITHOUT_CREDIT", "errors.INVALID_INPUT", "errors.LOT_REQUIRED", "errors.INVALID_INPUT"]);
    expect(await db.stockMovement.count({ where: { id: buy.movementId } })).toBe(0);
  });

  it("shows workers quantities, never prices, amounts or credit, and lets them write nothing here", async () => {
    const worker = { ...a, role: "worker" as const };
    const changes = (await pull(worker, 0, registry)).changes;
    expect(changes.some((c) => c.entity === "movement")).toBe(true);
    const purchases = changes.filter((c) => c.entity === "purchase");
    expect(purchases.length).toBeGreaterThan(0);
    expect(JSON.stringify(purchases)).not.toMatch(/Centimes|dueOn/);
    expect(await statuses(worker, [m(M.adjustStock, { id: uuidv7(), stockItemId: starter, day: "2026-11-06", quantity: 1, reason: "x" })])).toEqual(["errors.FORBIDDEN"]);
  });

  it("keeps each organisation's stock to itself", async () => {
    expect(
      await statuses(b, [
        m(M.createStockItem, { id: uuidv7(), farmId: farmA, productId: null, kind: "gas", name: "Gaz", unit: "unit", lot: null, expiresOn: null }), // a's farm
        m(M.adjustStock, { id: uuidv7(), stockItemId: starter, day: "2026-11-06", quantity: 5, reason: "x" }), // a's item
        m(M.createSupplier, { id: supplier, name: "copie", phone: null }), // a's supplier id
      ]),
    ).toEqual(["errors.NOT_FOUND", "errors.NOT_FOUND", "errors.ALREADY_EXISTS"]);
    const itemB = uuidv7();
    await push(b, [m(M.createStockItem, { id: itemB, farmId: farmB, productId: null, kind: "gas", name: "Gaz", unit: "unit", lot: null, expiresOn: null })], registry);
    expect(await statuses(b, [m(M.recordPurchase, { id: uuidv7(), movementId: uuidv7(), supplierId: supplier, stockItemId: itemB, day: "2026-11-05", quantity: 2, unitPriceCentimes: "1000", paidCentimes: "0", dueOn: null })])).toEqual(["errors.NOT_FOUND"]);
    expect((await pull(b, 0, registry)).changes.every((c) => c.id !== starter && c.id !== supplier)).toBe(true);
  });
});
