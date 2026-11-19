import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-10T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("credit limits (SPEC-finance FN12, T33)", () => {
  let owner: TenantContext, manager: TenantContext, other: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), buyer: uuidv7() };
  // 100 birds, 200 kg at 15,00 DH/kg = 3 000,00 DH, all on credit
  const creditSale = (id = uuidv7()) =>
    m("sales.recordSale", { id, batchId: ids.batch, buyerId: ids.buyer, day: "2026-03-10", birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "credit", paidCentimes: "0", instrument: null });
  const approval = async (saleId: string) => (await db.sale.findUniqueOrThrow({ where: { id: saleId } })).creditApproval;

  beforeAll(async () => {
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [owner, other] = await twoTenants();
    manager = { ...owner, role: "manager" };
    expect(
      await statuses(
        owner,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: "2026-02-01", chicksPlaced: 5000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null }),
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
      ),
    ).toEqual(["applied", "applied", "applied", "applied"]);
  });

  it("lets only the owner set a buyer's credit limit", async () => {
    expect(await statuses(manager, m("sales.setCreditLimit", { buyerId: ids.buyer, limitCentimes: "1000000" }))).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(owner, m("sales.setCreditLimit", { buyerId: ids.buyer, limitCentimes: "1000000" }))).toEqual(["applied"]); // 10 000,00 DH
    expect(await statuses(other, m("sales.setCreditLimit", { buyerId: ids.buyer, limitCentimes: "1" }))).toEqual(["errors.NOT_FOUND"]);
  });

  it("records a manager's credit sale past the limit as waiting for the owner, and tells the owner", async () => {
    const [s1, s2, s3, s4] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    expect(await statuses(manager, creditSale(s1), creditSale(s2), creditSale(s3))).toEqual(["applied", "applied", "applied"]); // 9 000,00
    expect([await approval(s1), await approval(s3)]).toEqual([null, null]);
    expect(await statuses(manager, creditSale(s4))).toEqual(["applied"]); // 12 000,00 > 10 000,00
    expect(await approval(s4)).toBe("pending");
    const notes = await db.notification.findMany({ where: { organizationId: owner.organizationId, templateKey: "creditApproval" } });
    expect(notes.map((n) => [n.userId, n.params])).toEqual([[owner.userId, { buyer: "Hamid", amount: expect.stringMatching(/3.000,00/), limit: expect.stringMatching(/10.000,00/) }]]);

    expect(await statuses(manager, m("sales.approveCredit", { saleId: s4 }))).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(owner, m("sales.approveCredit", { saleId: s4 }))).toEqual(["applied"]);
    expect(await approval(s4)).toBe("approved");
    expect(await statuses(owner, m("sales.approveCredit", { saleId: s4 }))).toEqual(["errors.NOT_FOUND"]); // no longer pending
  });

  it("doesn't hold the owner's own credit sale: they are the one who approves", async () => {
    const id = uuidv7();
    expect(await statuses(owner, creditSale(id))).toEqual(["applied"]);
    expect(await approval(id)).toBeNull();
  });

  it("never sends the limit or the approval to workers", async () => {
    const seen = (await pull({ ...owner, role: "worker" }, 0, registry)).changes;
    expect(JSON.stringify(seen)).not.toMatch(/creditLimitCentimes|creditApproval/);
    const buyer = (await pull(owner, 0, registry)).changes.filter((c) => c.entity === "buyer").at(-1)?.data;
    expect(buyer).toMatchObject({ creditLimitCentimes: "1000000" });
  });
});
