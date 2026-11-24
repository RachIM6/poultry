import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { batchResults, changeAccountingChoices, postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
// The expense below is booked in fiscal year 2026 as soon as it syncs, which locks that year's choices (FN1): the owner
// changes the key in January 2027, before that year's first entry. It applies to the batches' live shares all the same.
const in2027 = fixedClock("2027-01-15T10:00:00Z");
const in2026 = fixedClock("2026-11-20T10:00:00Z");

// SPEC-finance FN14 (§9 "FN14 allocation keys", 2026-11-23): shared costs follow the entity's key.
describe("shared-cost allocation keys (SPEC-finance FN14)", () => {
  let a: TenantContext, b: TenantContext, entity: string;
  const ids = { farm: uuidv7(), h1: uuidv7(), h2: uuidv7(), batchA: uuidv7(), batchB: uuidv7(), buyer: uuidv7() };
  const setKey = (allocationKey: unknown, ctx = a, clock = in2027) => changeAccountingChoices(ctx, entity, { books: null, pcaOverlay: null, fiscalYearStartMonth: 1, allocationKey }, clock);
  const results = async () => {
    const r = await batchResults(a);
    if (!r.ok) throw new Error(r.error);
    const row = (id: string) => r.value.find((x) => x.id === id)!;
    return { a: { allocated: row(ids.batchA).costs.allocated, byBirdDays: row(ids.batchA).byBirdDays }, b: { allocated: row(ids.batchB).costs.allocated, byBirdDays: row(ids.batchB).byBirdDays } };
  };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a, b] = await twoTenants();
    entity = (await listLegalEntities(a))[0].id;
    const place = (id: string, houseId: string, placedOn: string, chicks: number) =>
      m("flock.placeBatch", { id, houseId, strainId: "ross-308", placedOn, chicksPlaced: chicks, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null });
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.h1, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("farm-registry.createHouse", { id: ids.h2, farmId: ids.farm, name: "B2", areaM2: 800, capacity: 8000, type: "closed" }),
        place(ids.batchA, ids.h1, "2026-09-20", 1000), // October: 31 000 bird-days, 1 000 m² × 31 days
        place(ids.batchB, ids.h2, "2026-10-16", 500), // October: 8 000 bird-days, 800 m² × 16 days
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        // 3 900,00 of electricity for October, paid in November
        m("finance.recordExpense", { id: uuidv7(), day: "2026-11-05", category: "electricity", amountCentimes: "390000", paidFrom: "credit", treasuryId: null, note: null, batchId: null, serviceMonth: "2026-10" }),
      ),
    ).toEqual(Array(7).fill("applied"));
  });

  it("splits by bird-days by default", async () => {
    expect((await listLegalEntities(a))[0].allocationKey).toBe("birdDays");
    expect(await results()).toEqual({ a: { allocated: 310_000n, byBirdDays: false }, b: { allocated: 80_000n, byBirdDays: false } });
  });

  it("splits by house m² × days present once the owner picks it, audited", async () => {
    expect(await setKey("houseArea")).toEqual({ ok: true, value: undefined });
    expect((await listLegalEntities(a))[0].allocationKey).toBe("houseArea");
    expect(await db.auditEvent.findFirst({ where: { entity: "LegalEntity", entityId: entity, action: "update" } })).toMatchObject({
      before: expect.objectContaining({ allocationKey: "birdDays" }),
      after: expect.objectContaining({ allocationKey: "houseArea" }),
    });
    // 31 000 / 12 800 m²·days: 2 760,27 / 1 139,73
    expect(await results()).toEqual({ a: { allocated: 276_027n, byBirdDays: false }, b: { allocated: 113_973n, byBirdDays: false } });
  });

  it("by kg sold, falls back to bird-days while no batch sold in the period, then follows the sales", async () => {
    expect(await setKey("kgSold")).toMatchObject({ ok: true });
    expect(await results()).toEqual({ a: { allocated: 310_000n, byBirdDays: true }, b: { allocated: 80_000n, byBirdDays: true } });
    // B sells 50 birds (100 kg) on 31 October; A sells nothing in October: B takes it all
    expect(
      await statuses(a, m("sales.recordSale", { id: uuidv7(), batchId: ids.batchB, buyerId: ids.buyer, day: "2026-10-31", birds: 50, farmWeightGrams: 100_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "150000", instrument: null })),
    ).toEqual(["applied"]);
    expect(await results()).toEqual({ a: { allocated: 0n, byBirdDays: false }, b: { allocated: 390_000n, byBirdDays: false } });
  });

  it("rejects an unknown key, another organisation's entity and a manager; locked once the year has entries (FN1)", async () => {
    expect(await setKey("perHead")).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await setKey("houseArea", b)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await setKey("houseArea", { ...a, role: "manager" })).toEqual({ ok: false, error: "FORBIDDEN" });
    await postPending(a); // the expense and the sale are booked in fiscal year 2026
    expect(await setKey("birdDays", a, in2026)).toEqual({ ok: false, error: "FISCAL_YEAR_HAS_ENTRIES" });
    expect((await listLegalEntities(a))[0].allocationKey).toBe("kgSold");
  });
});
