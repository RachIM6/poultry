import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, closeFiscalYear, closePreview, createFixedAsset, postPending, runClose, saveHensSchedules, saveYearEndValues } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

// SPEC-finance FC5, FQ18 (PCA p. 42), §7.1 G: the suggested cost per egg at the close, from the laying flocks' feed,
// expenses, depreciation shares and the hens' own depreciation, over the eggs laid in the fiscal year.
const clock = fixedClock("2026-06-15T10:00:00Z");
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2025-11-05T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const counts = (c: Partial<Record<"normal" | "cracked" | "dirty" | "doubleYolk" | "floor" | "broken", number>>) => ({ normal: 0, cracked: 0, dirty: 0, doubleYolk: 0, floor: 0, broken: 0, ...c });
const collect = (batchId: string, day: string, c: Parameters<typeof counts>[0]) => m("eggs.recordCollection", { id: uuidv7(), batchId, day, counts: counts(c), sample: null });
const feedOn = (batchId: string, stockItemId: string, day: string, grams: number) => m("flock.recordDay", { batchId, day, changes: { dead: 0, culled: 0, feed: { stockItemId, grams } } });
const expense = (day: string, category: string, amount: string, more: { batchId?: string; serviceMonth?: string } = {}) =>
  m("finance.recordExpense", { id: uuidv7(), day, category, amountCentimes: amount, paidFrom: "credit", treasuryId: null, note: null, batchId: more.batchId ?? null, serviceMonth: more.serviceMonth ?? null });
/** A farm with one 1 000 m² house, a layer batch, and a feed item bought at 4,00 DH/kg. */
const layerFarm = (ids: { farm: string; house: string; batch: string; feed: string; supplier: string }, name: string, placedOn: string, chicks: number, price: string, boughtOn: string) => [
  m("farm-registry.createFarm", { id: ids.farm, name, region: "R", province: "P", commune: "C", gps: null, onssa: null }),
  m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "P1", areaM2: 1000, capacity: 6000, type: "closed" }),
  m("inventory.createSupplier", { id: ids.supplier, name: `Alf ${name}`, phone: null }),
  m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Ponte", unit: "kg", lot: null, expiresOn: null }),
  m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: boughtOn, quantity: 100_000_000, unitPriceCentimes: "400", paidCentimes: "0", dueOn: null }),
  m("flock.placeBatch", { id: ids.batch, houseId: ids.house, species: "layer", strainId: "isa-brown", placedOn, chicksPlaced: chicks, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: price, dayOldWeightGrams: null, ageAtPlacementDays: 120 }),
];
const newIds = () => ({ farm: uuidv7(), house: uuidv7(), batch: uuidv7(), feed: uuidv7(), supplier: uuidv7() });
const eggsOf = async (ctx: TenantContext) => {
  const preview = await closePreview(ctx, 2025, clock);
  if (!preview.ok) throw new Error(preview.error);
  return preview.value.eggs;
};

describe("the suggested cost per egg at the close (SPEC-finance FC5, FQ18: PCA p. 42)", () => {
  let owner: TenantContext, other: TenantContext, entity: string;
  const a = newIds();
  const [x, y, z] = [newIds(), newIds(), newIds()];

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((r) => ({ chart: r.chart, number: r.number, label: r.label, parentNumber: r.parent, fallback: r.fallback })) });
    await db.strain.create({ data: { id: "isa-brown", name: "ISA Brown", productionTypes: ["pullet", "layer"] } });
    owner = await tenant("+212600000001", "Ferme A");
    other = await tenant("+212600000002", "Ferme B");
    entity = (await listLegalEntities(owner))[0].id;
    const otherEntity = (await listLegalEntities(other))[0].id;
    // The PCA on (the default), the classic hens method (the default), FN14 by house m².
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1, allocationKey: "houseArea" })).toMatchObject({ ok: true });
    expect(await changeAccountingChoices(other, otherEntity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });

    // §7.1 G: 4 000 point-of-lay hens at 63,00 on 1 June 2025 (252 000,00 on 23711).
    expect(
      await statuses(
        owner,
        ...layerFarm(a, "Ferme Atlas", "2025-06-01", 4000, "6300", "2025-05-25"),
        feedOn(a.batch, a.feed, "2025-09-30", 45_000_000),
        feedOn(a.batch, a.feed, "2025-12-20", 45_000_000), // 90 000 kg × 4,00 = 360 000,00
        feedOn(a.batch, a.feed, "2026-01-02", 1_000_000), // after the last day: out
        expense("2025-10-15", "vet_fees", "300000", { batchId: a.batch }),
        expense("2025-11-10", "catching", "40000", { batchId: a.batch }), // distribution: out
        expense("2025-12-31", "electricity", "120000", { serviceMonth: "2025-12" }), // the only batch: all of it
        collect(a.batch, "2025-08-31", { normal: 340_000, cracked: 5_000, broken: 2_000 }),
        collect(a.batch, "2025-12-30", { normal: 350_000, dirty: 5_000, broken: 3_000 }), // 700 000 into the stock, the broken lost
        collect(a.batch, "2026-01-02", { normal: 1_000 }), // after the last day: out
      ),
    ).toEqual(Array(15).fill("applied"));
    // The house: 300 000,00 over 240 months from January 2025, 15 000,00 in 2025.
    expect(
      await createFixedAsset(owner, { id: uuidv7(), label: "Bâtiment P1", category: "building", houseId: a.house, acquiredOn: "2025-01-01", inServiceOn: "2025-01-01", amountCentimes: "30000000", lifeMonths: 240, paidWith: "credit" }, clock),
    ).toEqual({ ok: true, value: undefined });
    await postPending(owner); // the hens on 23711 (FC6 classic)

    // Ferme Rif: laid only in 2024; Ferme Souss: placed in 2024, costs and eggs in both years; Ferme Doukkala: eggs, no cost.
    expect(
      await statuses(
        other,
        ...layerFarm(x, "Ferme Rif", "2024-11-01", 1000, "0", "2024-10-25"),
        ...layerFarm(y, "Ferme Souss", "2024-11-01", 1000, "0", "2024-10-25"),
        ...layerFarm(z, "Ferme Doukkala", "2025-03-01", 1000, "0", "2025-02-25"),
        feedOn(x.batch, x.feed, "2024-12-15", 1_000_000),
        feedOn(x.batch, x.feed, "2025-06-15", 1_000_000),
        collect(x.batch, "2024-12-20", { normal: 5_000 }),
        feedOn(y.batch, y.feed, "2024-12-15", 2_000_000), // before the fiscal year: out
        feedOn(y.batch, y.feed, "2025-12-15", 3_000_000), // 3 000 kg × 4,00 = 12 000,00
        collect(y.batch, "2024-12-20", { normal: 1_000 }), // before the fiscal year: out
        collect(y.batch, "2025-12-20", { normal: 6_000 }),
        collect(z.batch, "2025-12-30", { normal: 800 }),
      ),
    ).toEqual(Array(26).fill("applied"));
  }, 60_000); // two organisations and 41 mutations: above the 10 s hook default on a loaded Windows Docker

  it("§7.1 G: feed, vet fees, the house's share, December's electricity and the hens' depreciation ÷ 700 000 eggs = 0,65", async () => {
    // Without the hens' life and cull value, their depreciation isn't counted yet: 372 994,52 ÷ 700 000 = 0,53.
    expect(await eggsOf(owner)).toMatchObject([
      { farm: "Ferme Atlas", quantity: 700_000, perEgg: null, missing: true, suggestion: { direct: 36_300_000n, depreciation: 879_452n, indirect: 120_000n, hens: 0n, total: 37_299_452n, eggs: 700_000, perEgg: 53n, reason: null, from: "2025-06-01", to: "2025-12-31", hensPending: true } },
    ]);
    expect(await saveHensSchedules(owner, { year: 2025, values: { [a.batch]: { life: "14", cull: "90 000" } } })).toEqual({ ok: true, value: 1 });
    expect(await eggsOf(owner)).toMatchObject([{ suggestion: { hens: 8_100_000n, total: 45_399_452n, perEgg: 65n, hensPending: false } }]); // 162 000,00 × 7 ÷ 14

    // Only a suggestion: nothing saved, the run still refuses without the owner's value.
    expect(await db.yearEndValue.count({ where: { legalEntityId: entity, kind: "eggs" } })).toBe(0);
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: false, error: "EGG_VALUE_MISSING" });
  });

  it("gives no suggestion without eggs laid or without costs in the year, and counts the year's facts only", async () => {
    const eggs = await eggsOf(other);
    const of = (farm: string) => eggs.find((e) => e.farm === farm)?.suggestion;
    expect(of("Ferme Rif")).toMatchObject({ perEgg: null, reason: "NO_EGGS", eggs: 0, direct: 400_000n }); // costs in 2025, eggs only in 2024
    expect(of("Ferme Doukkala")).toMatchObject({ perEgg: null, reason: "NO_COSTS", eggs: 800, total: 0n, from: "2025-03-01" });
    expect(of("Ferme Souss")).toMatchObject({ perEgg: 200n, reason: null, eggs: 6_000, total: 1_200_000n, from: "2025-01-01" }); // 12 000,00 ÷ 6 000
  });

  it("leaves a closed year as posted: the owner's value, the entry and the refusal to run again", async () => {
    expect(await saveYearEndValues(owner, { year: 2025, values: { [a.farm]: "0,65" } })).toEqual({ ok: true, value: 1 });
    expect(await runClose(owner, { year: 2025 }, clock)).toMatchObject({ ok: true });
    expect(await closeFiscalYear(owner, { year: 2025 }, clock)).toMatchObject({ ok: true });
    const posted = await db.journalLine.findMany({ where: { entry: { legalEntityId: entity } }, orderBy: { id: "asc" } });
    const eggs = await db.journalLine.findMany({ where: { entry: { sourceId: `close:stock:${entity}:2025` }, account: { in: ["3152", "71321"] } }, select: { account: true, debitCentimes: true, creditCentimes: true }, orderBy: { account: "asc" } });
    expect(eggs).toEqual([{ account: "3152", debitCentimes: 45_500_000n, creditCentimes: 0n }, { account: "71321", debitCentimes: 0n, creditCentimes: 45_500_000n }]); // 700 000 × 0,65, the feed left beside it

    // Still shown, read-only: the owner's value stays, nothing posts again.
    const preview = await closePreview(owner, 2025, clock);
    expect(preview).toMatchObject({ ok: true, value: { frozen: true, eggs: [{ perEgg: 65n, suggestion: { perEgg: 65n } }] } });
    expect(await saveYearEndValues(owner, { year: 2025, values: { [a.farm]: "0,70" } })).toEqual({ ok: false, error: "COUNT_FROZEN" });
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await db.journalLine.findMany({ where: { entry: { legalEntityId: entity } }, orderBy: { id: "asc" } })).toEqual(posted);
  });
});
