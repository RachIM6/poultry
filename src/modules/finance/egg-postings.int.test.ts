import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-17T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: ReturnType<typeof m>[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("egg sales in the books (SPEC-m3 V8)", () => {
  let a: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), layers: uuidv7(), buyer: uuidv7(), sale: uuidv7() };
  const today = farmDayOf(new Date());

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "lohmann-brown", name: "Lohmann Brown", productionTypes: ["pullet", "layer"] } });
    [a] = await twoTenants();
    const laidOn = addFarmDays(today, -1);
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "P1", areaM2: 1000, capacity: 6000, type: "closed" }),
        m("flock.placeBatch", { id: ids.layers, houseId: ids.house, species: "layer", strainId: "lohmann-brown", placedOn: addFarmDays(today, -5), chicksPlaced: 6000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 200 }),
        m("eggs.recordCollection", { id: uuidv7(), batchId: ids.layers, day: laidOn, counts: { normal: 600, cracked: 0, dirty: 0, doubleYolk: 0, floor: 0, broken: 0 }, sample: null }),
        m("eggs.gradeEggs", { id: uuidv7(), batchId: ids.layers, laidOn, grades: { m: 600 } }),
        m("sales.createBuyer", { id: ids.buyer, name: "Grossiste", phone: null, type: "trader" }),
        m("sales.recordEggSale", { id: ids.sale, batchId: ids.layers, buyerId: ids.buyer, day: today, lines: [{ item: "grade:m", eggs: 450, unitPriceCentimes: "3300" }], paymentMethod: "cash", paidCentimes: "20000", instrument: null }),
      ),
    ).toEqual(Array(7).fill("applied"));
  });

  it("posts an egg sale to the buyer and to Ventes de produits d'animaux (PCA 71213), with the cash received", async () => {
    await postPending(a);
    const lines = (await db.journalLine.findMany({ where: { entry: { sourceId: ids.sale } }, orderBy: [{ account: "asc" }, { debitCentimes: "asc" }] })).map((l) => [l.account, l.debitCentimes, l.creditCentimes]);
    expect(lines).toEqual([
      ["3421", 0n, 20_000n],
      ["3421", 49_500n, 0n],
      ["5161", 20_000n, 0n],
      ["71213", 0n, 49_500n],
    ]);
  });
});
