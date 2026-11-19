import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import type { SoldBirdsDto } from "@/modules/flock/schema";
import { SALES_MUTATIONS as S, type SaleDto } from "@/modules/sales/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-17T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("sale per head (SPEC-m3 V7)", () => {
  let a: TenantContext;
  const ids = { farm: uuidv7(), run: uuidv7(), band: uuidv7(), buyer: uuidv7() };
  const today = farmDayOf(new Date());
  const sale = (over: object = {}) =>
    m(S.recordHeadSale, {
      id: uuidv7(),
      batchId: ids.band,
      buyerId: ids.buyer,
      day: today,
      lines: [
        { item: "rooster", birds: 6, pricePerHeadCentimes: "8500" },
        { item: "hen", birds: 4, pricePerHeadCentimes: "7000" },
      ],
      farmWeightGrams: null,
      paymentMethod: "cash",
      paidCentimes: "79000",
      instrument: null,
      ...over,
    });

  beforeAll(async () => {
    [a] = await twoTenants();
    await db.strain.create({ data: { id: "unspecified-beldi", name: "Beldi", productionTypes: ["beldi"] } });
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.run, farmId: ids.farm, name: "Parcours", areaM2: 2000, capacity: 1000, type: "open" }),
        m("flock.placeBatch", { id: ids.band, houseId: ids.run, species: "beldi", strainId: "unspecified-beldi", placedOn: addFarmDays(today, -10), chicksPlaced: 140, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 140 }),
        m(S.createBuyer, { id: ids.buyer, name: "Client de passage", phone: null, type: "other" }),
      ),
    ).toEqual(Array(4).fill("applied"));
  });

  it("6 roosters × 85,00 + 4 hens × 70,00 = 790,00 DH; 10 birds leave the band", async () => {
    const given = sale();
    expect(await statuses(a, given)).toEqual(["applied"]);
    const changes = (await pull(a, 0, registry)).changes;
    const s = changes.filter((c) => c.entity === "sale").map((c) => c.data as SaleDto).find((x) => x.id === (given.payload as { id: string }).id);
    expect(s).toMatchObject({ kind: "perHead", birds: 10, amountCentimes: "79000", lines: [{ item: "rooster", eggs: 6, eggsPerTray: 1 }, { item: "hen", eggs: 4 }] });
    expect(changes.filter((c) => c.entity === "soldBirds").map((c) => (c.data as SoldBirdsDto).birds)).toEqual([10]);
    expect(await statuses(a, sale({ lines: [{ item: "bird", birds: 131, pricePerHeadCentimes: "7000" }] }))).toEqual(["errors.MORE_BIRDS_THAN_ON_HAND"]);
  });

  it("is blocked while a withdrawal runs on the band (V3)", async () => {
    const item = await db.stockItem.create({ data: { id: uuidv7(), organizationId: a.organizationId, farmId: ids.farm, kind: "medicine", name: "M", unit: "ml" } });
    const date = (d: string) => new Date(`${d}T00:00:00Z`);
    await db.treatment.create({
      data: { id: uuidv7(), organizationId: a.organizationId, batchId: ids.band, stockItemId: item.id, quantity: 1, dose: "d", startOn: date(today), endOn: date(today), reason: "r", prescriber: "p", withdrawalDays: 3, withdrawalEndsOn: date(addFarmDays(today, 3)), recordedBy: a.userId },
    });
    expect(await statuses(a, sale())).toEqual(["errors.WITHDRAWAL_IN_PROGRESS"]);
  });
});
