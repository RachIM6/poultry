import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { flockSync } from "@/modules/flock";
import { FLOCK_MUTATIONS as F } from "@/modules/flock/schema";
import { healthSync } from "@/modules/health";
import { salesSync, sendInstrumentReminders } from "@/modules/sales";
import { SALES_MUTATIONS as S, buyerBalances, type PaymentDto, type SaleDto } from "@/modules/sales/schema";
import { twoTenants } from "@/test/tenant";

const registry: SyncRegistry = {
  mutations: { ...flockSync.mutations, ...healthSync.mutations, ...salesSync.mutations },
  entities: { ...flockSync.entities, ...healthSync.entities, ...salesSync.entities },
};
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-08T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));
const pulled = async <T,>(ctx: TenantContext, entity: string) => (await pull(ctx, 0, registry)).changes.filter((c) => c.entity === entity).map((c) => c.data as T);

describe("receivables and due-date reminders (SPEC V4)", () => {
  let a: TenantContext, b: TenantContext;
  const [farm, house, batch, buyer] = Array.from({ length: 4 }, () => uuidv7());
  const sale = (payload: object) =>
    m(S.recordSale, { id: uuidv7(), batchId: batch, buyerId: buyer, day: "2026-11-08", birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", ...payload });
  const payment = (payload: object = {}) => m(S.recordPayment, { id: uuidv7(), buyerId: buyer, day: "2026-11-08", amountCentimes: "100000", method: "cash", ...payload });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    // The farm and its house straight in the database: sales doesn't depend on farm-registry (CAPABILITY-MAP.md).
    await db.farm.create({ data: { id: farm, organizationId: a.organizationId, name: "F", region: "R", province: "P", commune: "C" } });
    await db.house.create({ data: { id: house, organizationId: a.organizationId, farmId: farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } });
    expect(
      await statuses(a, [
        m(F.placeBatch, { id: batch, houseId: house, strainId: "ross-308", placedOn: "2026-10-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null }),
        m(S.createBuyer, { id: buyer, name: "Abattoir Atlas", phone: null, type: "abattoir" }),
        // 200 kg × 15 DH = 3 000 DH each
        sale({ paymentMethod: "cash", paidCentimes: "300000", instrument: null }), // paid: nothing owed
        sale({ paymentMethod: "cheque", paidCentimes: "0", instrument: { number: "0012345", dueOn: "2026-11-20" } }),
        sale({ paymentMethod: "credit", paidCentimes: "50000", instrument: null }), // 2 500 DH owed
      ]),
    ).toEqual(Array(5).fill("applied"));
  });

  it("a buyer pays later, up to what they owe; the balance is sales − payments", async () => {
    expect(await statuses(a, [payment({ amountCentimes: "550001" })])).toEqual(["PAID_MORE_THAN_BALANCE"]); // owes 5 500 DH
    expect(await statuses(a, [payment({ day: "2026-12-31" })])).toEqual(["DAY_IN_FUTURE"]);
    expect(await statuses(b, [payment()])).toEqual(["NOT_FOUND"]); // a's buyer
    expect(await statuses({ ...a, role: "worker" }, [payment()])).toEqual(["FORBIDDEN"]);
    expect(await statuses(a, [payment({ amountCentimes: "300000", method: "cheque" }), payment({ amountCentimes: "250001" })])).toEqual(["applied", "PAID_MORE_THAN_BALANCE"]);
    expect(await statuses(a, [payment({ amountCentimes: "250000" })])).toEqual(["applied"]); // the rest

    const sales = (await pulled<SaleDto>(a, "sale")).map((s) => ({ buyerId: s.buyerId, amountCentimes: BigInt(s.amountCentimes!), paidCentimes: BigInt(s.paidCentimes!) }));
    const payments = (await pulled<PaymentDto>(a, "buyerPayment")).map((p) => ({ buyerId: p.buyerId, amountCentimes: BigInt(p.amountCentimes) }));
    expect(buyerBalances(sales, payments).get(buyer)).toBe(0n);
    expect(Object.keys((await pulled<PaymentDto>({ ...a, role: "worker" }, "buyerPayment"))[0]).sort()).toEqual(["buyerId", "day", "id"]);
    expect(await pulled(b, "buyerPayment")).toEqual([]);
    expect(await db.auditEvent.count({ where: { entity: "BuyerPayment", organizationId: a.organizationId } })).toBe(2);
  });

  it("announces a cheque or bill once, on its due day, to those who see money", async () => {
    expect(await sendInstrumentReminders(fixedClock("2026-11-19T12:00:00Z"))).toBe(0); // the day before
    expect(await sendInstrumentReminders(fixedClock("2026-11-20T01:00:00Z"))).toBe(1);
    expect(await sendInstrumentReminders(fixedClock("2026-11-20T09:00:00Z"))).toBe(0); // once
    const [n] = await db.notification.findMany({ where: { organizationId: a.organizationId, templateKey: "instrumentDue" } });
    expect(n).toMatchObject({ userId: a.userId, params: { method: "cheque", number: "0012345", buyer: "Abattoir Atlas" } });
    expect((n.params as { amount: string }).amount).toMatch(/^3.000,00\sDH$/);
    expect(await db.notification.count({ where: { organizationId: b.organizationId } })).toBe(0);
  });
});
