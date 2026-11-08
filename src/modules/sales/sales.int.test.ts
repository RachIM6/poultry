import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { flockSync } from "@/modules/flock";
import { FLOCK_MUTATIONS as F, type SoldBirdsDto } from "@/modules/flock/schema";
import { healthSync } from "@/modules/health";
import { HEALTH_MUTATIONS as H } from "@/modules/health/schema";
import { salesSync } from "@/modules/sales";
import { SALES_MUTATIONS as S, type SaleDto } from "@/modules/sales/schema";
import { twoTenants } from "@/test/tenant";

const registry: SyncRegistry = {
  mutations: { ...flockSync.mutations, ...healthSync.mutations, ...salesSync.mutations },
  entities: { ...flockSync.entities, ...healthSync.entities, ...salesSync.entities },
};
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));
const pulled = async <T,>(ctx: TenantContext, entity: string) => (await pull(ctx, 0, registry)).changes.filter((c) => c.entity === entity).map((c) => c.data as T);

describe("live-bird sales (SPEC V1–V3, B5)", () => {
  let a: TenantContext, b: TenantContext;
  const [farm, house, batch, medicine, buyer] = Array.from({ length: 5 }, () => uuidv7());
  const sale = (payload: object = {}) =>
    m(S.recordSale, {
      id: uuidv7(),
      batchId: batch,
      buyerId: buyer,
      day: "2026-11-08",
      birds: 300,
      farmWeightGrams: 600_000,
      buyerWeightGrams: 588_000,
      pricePerKgCentimes: "1450",
      paymentMethod: "cash",
      paidCentimes: "870000",
      instrument: null,
      ...payload,
    });
  const written = async () => [await db.sale.count(), await db.soldBirds.count()];

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    // The farm, its house and a medicine lot straight in the database: sales doesn't depend on farm-registry or
    // inventory (CAPABILITY-MAP.md).
    await db.farm.create({ data: { id: farm, organizationId: a.organizationId, name: "F", region: "R", province: "P", commune: "C" } });
    await db.house.create({ data: { id: house, organizationId: a.organizationId, farmId: farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } });
    await db.stockItem.create({ data: { id: medicine, organizationId: a.organizationId, farmId: farm, kind: "medicine", name: "Amoxicilline", unit: "ml", lot: "L1", expiresOn: new Date("2027-06-30") } });
    expect(
      await statuses(a, [
        m(F.placeBatch, { id: batch, houseId: house, strainId: "ross-308", placedOn: "2026-10-25", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null }),
        // Made-up withdrawal days (the real ones come from the label, OQ4): ends 2 Nov + 5 days → runs through 7 Nov.
        m(H.recordTreatment, { id: uuidv7(), batchId: batch, stockItemId: medicine, quantity: 100, dose: "1 ml/L", startOn: "2026-10-30", endOn: "2026-11-02", reason: "Toux", prescriber: "Dr Alaoui", withdrawalDays: 5 }),
        m(S.createBuyer, { id: buyer, name: "Abattoir Atlas", phone: "0612345678", type: "abattoir" }),
      ]),
    ).toEqual(Array(3).fill("applied"));
  });

  it("V3: refuses a sale while a withdrawal runs on its day, also one made offline and pushed later", async () => {
    expect(await statuses(a, [sale({ day: "2026-11-05" })])).toEqual(["WITHDRAWAL_IN_PROGRESS"]); // made offline on the 5th
    expect(await statuses(a, [sale({ day: "2026-11-07" })])).toEqual(["WITHDRAWAL_IN_PROGRESS"]); // its last day
    expect(await written()).toEqual([0, 0]); // nothing written, birds still on hand
    expect(await statuses(a, [sale({ day: "2026-10-29", birds: 1 })])).toEqual(["applied"]); // before the treatment began
  });

  it("V2: computes the amount from the farm weight and keeps the money from workers", async () => {
    expect(await statuses(b, [m(S.createBuyer, { id: uuidv7(), name: "X", phone: null, type: "trader" }), sale()])).toEqual(["applied", "NOT_FOUND"]); // a's buyer
    expect(await statuses(a, [sale({ paymentMethod: "cheque", paidCentimes: "0" })])).toEqual(["INSTRUMENT_REQUIRED"]);
    expect(await statuses(a, [sale({ paidCentimes: "870001" })])).toEqual(["PAID_MORE_THAN_AMOUNT"]);
    expect(await statuses({ ...a, role: "worker" }, [sale()])).toEqual(["FORBIDDEN"]);

    const given = sale({ day: "2026-11-08" }); // the day after the withdrawal
    expect(await statuses(a, [given])).toEqual(["applied"]);
    const id = (given.payload as { id: string }).id;
    expect((await pulled<SaleDto>(a, "sale")).filter((s) => s.id === id)).toEqual([expect.objectContaining({ id, amountCentimes: "870000", paymentMethod: "cash", paidCentimes: "870000" })]); // 600 kg × 14,50
    const [, forWorker] = await pulled<SaleDto>({ ...a, role: "worker" }, "sale");
    expect(Object.keys(forWorker).sort()).toEqual(["batchId", "birds", "buyerId", "buyerWeightGrams", "day", "farmWeightGrams", "id"]);
    expect(await pulled(b, "sale")).toEqual([]);
    expect(await db.auditEvent.count({ where: { entity: "Sale", entityId: id } })).toBe(1);
  });

  it("B5: a partial sale lowers birds on hand and keeps the batch open; nothing sells or dies beyond them", async () => {
    expect((await pulled<SoldBirdsDto>(a, "soldBirds")).map((s) => [s.day, s.birds, s.liveWeightGrams])).toEqual([["2026-10-29", 1, 600_000], ["2026-11-08", 300, 600_000]]);
    // 1 000 − 301 sold = 699 on hand
    expect(await statuses(a, [m(F.recordDay, { batchId: batch, day: "2026-11-08", changes: { dead: 700, deathCause: "heat" } })])).toEqual(["MORE_DEAD_THAN_ON_HAND"]);
    expect(await statuses(a, [sale({ birds: 700 })])).toEqual(["MORE_BIRDS_THAN_ON_HAND"]);
    expect(await statuses(a, [sale({ birds: 699, paymentMethod: "bill", paidCentimes: "0", instrument: { number: "T-0042", dueOn: "2026-12-15" } })])).toEqual(["applied"]);
    expect((await db.batch.findUniqueOrThrow({ where: { id: batch } })).status).toBe("open"); // closing is T24
    expect(await db.sale.findFirst({ where: { instrumentNumber: "T-0042" }, select: { instrumentDueOn: true } })).toEqual({ instrumentDueOn: new Date("2026-12-15T00:00:00Z") });
  });
});
