import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { flockSync } from "@/modules/flock";
import { FLOCK_MUTATIONS as F } from "@/modules/flock/schema";
import { healthSync } from "@/modules/health";
import { salesSync } from "@/modules/sales";
import { SALES_MUTATIONS as S, type BuyerDto, type SaleDto } from "@/modules/sales/schema";
import { twoTenants } from "@/test/tenant";

const registry: SyncRegistry = {
  mutations: { ...flockSync.mutations, ...healthSync.mutations, ...salesSync.mutations },
  entities: { ...flockSync.entities, ...healthSync.entities, ...salesSync.entities },
};
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));
const pulled = async <T,>(ctx: TenantContext, entity: string, id: string) => (await pull(ctx, 0, registry)).changes.findLast((c) => c.entity === entity && c.id === id)?.data as T | undefined;

// Made-up names and addresses: the fields are the arrêté's (2126-05, art. 4), the values only test the mechanics.
describe("the register's buyer address and live birds' destination (arrêté 2126-05 art. 4)", () => {
  let a: TenantContext, b: TenantContext;
  const [farm, house, batch, buyer] = Array.from({ length: 4 }, () => uuidv7());
  const destination = { name: "Abattoir Atlas, site de Berrechid", address: "Zone industrielle, Berrechid" };
  const sale = (payload: object = {}) =>
    m(S.recordSale, { id: uuidv7(), batchId: batch, buyerId: buyer, day: "2026-11-01", birds: 10, farmWeightGrams: 20_000, buyerWeightGrams: null, pricePerKgCentimes: "1450", paymentMethod: "cash", paidCentimes: "29000", instrument: null, ...payload });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    // The farm and its house straight in the database: sales doesn't depend on farm-registry (CAPABILITY-MAP.md).
    await db.farm.create({ data: { id: farm, organizationId: a.organizationId, name: "F", region: "R", province: "P", commune: "C" } });
    await db.house.create({ data: { id: house, organizationId: a.organizationId, farmId: farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } });
    expect(
      await statuses(a, [
        m(F.placeBatch, { id: batch, houseId: house, strainId: "ross-308", placedOn: "2026-10-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null }),
        m(S.createBuyer, { id: buyer, name: "Négociant Atlas", phone: null, type: "trader", address: " 4 souk El Had, Settat " }),
      ]),
    ).toEqual(["applied", "applied"]);
  });

  it("a buyer's address is kept with the buyer (trimmed), optional for a buyer created without it", async () => {
    expect(await pulled<BuyerDto>(a, "buyer", buyer)).toMatchObject({ address: "4 souk El Had, Settat" });
    const plain = uuidv7();
    expect(await statuses(a, [m(S.createBuyer, { id: plain, name: "X", phone: null, type: "other" })])).toEqual(["applied"]); // an older phone
    expect(await pulled<BuyerDto>(a, "buyer", plain)).toMatchObject({ address: null });
    expect(await statuses(a, [m(S.createBuyer, { id: uuidv7(), name: "Y", phone: null, type: "other", address: "x".repeat(201) })])).toEqual(["INVALID_INPUT"]);
  });

  it("an owner or manager sets a known buyer's address from the sale form; audited; replayed once", async () => {
    const manager = { ...a, role: "manager" as const };
    const set = m(S.setBuyerAddress, { buyerId: buyer, address: "12 route de Casablanca, Settat" });
    expect(await statuses(manager, [set])).toEqual(["applied"]);
    expect(await statuses(manager, [set])).toEqual(["applied"]); // the same mutation again: its stored result
    expect(await pulled<BuyerDto>(a, "buyer", buyer)).toMatchObject({ name: "Négociant Atlas", address: "12 route de Casablanca, Settat" });
    expect(await db.auditEvent.findMany({ where: { mutationId: set.id }, select: { entity: true, action: true, before: true, after: true } })).toEqual([
      { entity: "Buyer", action: "address", before: { address: "4 souk El Had, Settat" }, after: { address: "12 route de Casablanca, Settat" } },
    ]);
    expect(await statuses(a, [m(S.setBuyerAddress, { buyerId: buyer, address: "" })])).toEqual(["applied"]); // blank clears it
    expect((await db.buyer.findUniqueOrThrow({ where: { id: buyer } })).address).toBeNull();
  });

  it("workers can't set it; another organisation can't set or read it", async () => {
    await push(a, [m(S.setBuyerAddress, { buyerId: buyer, address: "Settat" })], registry);
    expect(await statuses({ ...a, role: "worker" }, [m(S.setBuyerAddress, { buyerId: buyer, address: "pris" })])).toEqual(["FORBIDDEN"]);
    expect(await statuses(b, [m(S.setBuyerAddress, { buyerId: buyer, address: "pris" })])).toEqual(["NOT_FOUND"]);
    expect((await db.buyer.findUniqueOrThrow({ where: { id: buyer } })).address).toBe("Settat");
    expect(await pulled(b, "buyer", buyer)).toBeUndefined();
  });

  it("a live sale keeps where the birds went when not to the buyer, by the kg or by the head; none by default", async () => {
    const byKg = sale({ destination });
    const byHead = m(S.recordHeadSale, {
      id: uuidv7(),
      batchId: batch,
      buyerId: buyer,
      day: "2026-11-01",
      lines: [{ item: "bird", birds: 5, pricePerHeadCentimes: "3000" }],
      farmWeightGrams: null,
      paymentMethod: "cash",
      paidCentimes: "15000",
      instrument: null,
      destination: { name: "Ferme Bouskoura", address: null },
    });
    const plain = sale(); // an older phone: no destination
    expect(await statuses(a, [byKg, byHead, plain])).toEqual(["applied", "applied", "applied"]);
    expect(await statuses(a, [byKg])).toEqual(["applied"]); // replayed: no second sale
    const id = (x: PushedMutation) => (x.payload as { id: string }).id;
    expect(await db.sale.count({ where: { id: id(byKg) } })).toBe(1);
    expect(await pulled<SaleDto>(a, "sale", id(byKg))).toMatchObject({ destination });
    expect(await pulled<SaleDto>({ ...a, role: "worker" }, "sale", id(byHead))).toMatchObject({ destination: { name: "Ferme Bouskoura", address: null } }); // not money
    expect(await pulled<SaleDto>(a, "sale", id(plain))).toMatchObject({ destination: null });
    expect(await db.sale.findUniqueOrThrow({ where: { id: id(byKg) } })).toMatchObject({ destinationName: destination.name, destinationAddress: destination.address });
    expect(await db.auditEvent.findFirstOrThrow({ where: { mutationId: byKg.id } })).toMatchObject({ entity: "Sale", after: { destination } });
    expect(await pulled(b, "sale", id(byKg))).toBeUndefined();

    expect(await statuses(a, [sale({ destination: { name: "", address: "Berrechid" } }), sale({ destination: { name: "Ferme" } })])).toEqual(["INVALID_INPUT", "INVALID_INPUT"]);
  });
});
