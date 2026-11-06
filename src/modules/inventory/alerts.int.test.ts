import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { push } from "@/lib/sync/server";
import type { Role, TenantContext } from "@/lib/tenant";
import { farmRegistrySync } from "@/modules/farm-registry";
import { FARM_MUTATIONS } from "@/modules/farm-registry/schema";
import { inventorySync as registry } from "@/modules/inventory";
import { INVENTORY_MUTATIONS as M } from "@/modules/inventory/schema";
import { tenant } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });
const kg = (n: number) => n * 1000;

describe("low-stock alerts (SPEC S6)", () => {
  let owner: TenantContext;
  const users: Partial<Record<Role, string>> = {};
  const farm = uuidv7();
  const supplier = uuidv7();

  const member = async (role: Role, phone: string) => {
    const user = await db.user.create({ data: { phoneNumber: phone, name: phone, email: `${phone.slice(1)}@phone.invalid` } });
    await db.membership.create({ data: { organizationId: owner.organizationId, userId: user.id, role } });
    users[role] = user.id;
  };
  const alertsFor = (role: Role) => db.notification.count({ where: { userId: users[role], templateKey: "lowStock" } });
  const feedItem = async (thresholdKg: number | null, stockKg: number) => {
    const id = uuidv7();
    await push(owner, [
      m(M.createStockItem, { id, farmId: farm, productId: null, kind: "feed", name: "Croissance", unit: "kg", lot: null, expiresOn: null, lowStockThreshold: thresholdKg && kg(thresholdKg) }),
      m(M.recordPurchase, { id: uuidv7(), movementId: uuidv7(), supplierId: supplier, stockItemId: id, day: "2026-11-01", quantity: kg(stockKg), unitPriceCentimes: "400", paidCentimes: "0", dueOn: null }),
    ], registry);
    return id;
  };
  const adjust = (stockItemId: string, deltaKg: number) =>
    push(owner, [m(M.adjustStock, { id: uuidv7(), stockItemId, day: "2026-11-05", quantity: kg(deltaKg), reason: "pesée" })], registry);

  beforeAll(async () => {
    owner = await tenant("+212670000001");
    users.owner = owner.userId;
    await member("manager", "+212670000002");
    await member("worker", "+212670000003");
    const farmFields = { name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null };
    await push(owner, [m(FARM_MUTATIONS.createFarm, { id: farm, ...farmFields })], farmRegistrySync);
    await push(owner, [m(M.createSupplier, { id: supplier, name: "Alf", phone: null })], registry);
  });

  it("alerts owners and managers once when stock crosses below, and again only after a restock", async () => {
    const item = await feedItem(500, 1000);
    await adjust(item, -300); // 700 kg
    expect(await alertsFor("owner")).toBe(0);
    await adjust(item, -300); // 400 kg: crossed
    await adjust(item, -100); // 300 kg: still below, no new alert
    expect([await alertsFor("owner"), await alertsFor("manager"), await alertsFor("worker")]).toEqual([1, 1, 0]);

    await push(owner, [m(M.recordPurchase, { id: uuidv7(), movementId: uuidv7(), supplierId: supplier, stockItemId: item, day: "2026-11-06", quantity: kg(600), unitPriceCentimes: "400", paidCentimes: "0", dueOn: null })], registry);
    await adjust(item, -500); // 900 → 400 kg: crossed again
    expect(await alertsFor("owner")).toBe(2);
    const last = await db.notification.findFirstOrThrow({ where: { userId: users.owner, templateKey: "lowStock" }, orderBy: { createdAt: "desc" } });
    expect(last.params).toEqual({ item: "Croissance", quantity: "400", unit: "kg", threshold: "500" });
  });

  it("sends one alert when two corrections cross at the same moment", async () => {
    const before = await alertsFor("owner");
    const item = await feedItem(500, 600);
    await Promise.all([adjust(item, -150), adjust(item, -150)]); // 600 → 450 → 300: only one of them crosses
    expect((await alertsFor("owner")) - before).toBe(1);
  });

  it("lets owners and managers set or clear the threshold; nothing alerts without one", async () => {
    const before = await alertsFor("owner");
    const item = await feedItem(null, 100);
    await adjust(item, -90);
    expect(await alertsFor("owner")).toBe(before);

    const worker = { ...owner, userId: users.worker!, role: "worker" as const };
    const set = (ctx: TenantContext, value: number | null) =>
      push(ctx, [m(M.setThreshold, { stockItemId: item, lowStockThreshold: value })], registry).then((r) => r.results[0]);
    expect(await set(worker, kg(5))).toMatchObject({ status: "rejected", messageKey: "errors.FORBIDDEN" });
    expect(await set(owner, kg(5))).toMatchObject({ status: "applied" });
    expect((await db.stockItem.findUniqueOrThrow({ where: { id: item } })).lowStockThreshold).toBe(kg(5));
    await adjust(item, -6); // 10 → 4 kg
    expect(await alertsFor("owner")).toBe(before + 1);
  });
});
