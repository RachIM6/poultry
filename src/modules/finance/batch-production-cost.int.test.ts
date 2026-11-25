import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { batchResults, changeAccountingChoices, closeFiscalYear, closePreview, createFixedAsset, runClose, saveYearEndCount } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

// SPEC-finance FC4, FQ19 (PCA pp. 42–43), §7.1 F: §7.1 C's broiler batch with the depreciation of its house and of the
// farm's generator, and the shared production charges of December.
const clock = fixedClock("2026-06-15T10:00:00Z");
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2025-11-05T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const OK = { ok: true, value: undefined };
const expense = (day: string, category: string, amount: string, more: { batchId?: string; serviceMonth?: string; treasuryId?: string } = {}) =>
  m("finance.recordExpense", {
    id: uuidv7(),
    day,
    category,
    amountCentimes: amount,
    paidFrom: more.treasuryId ? "bank" : "credit",
    treasuryId: more.treasuryId ?? null,
    note: null,
    batchId: more.batchId ?? null,
    serviceMonth: more.serviceMonth ?? null,
  });

type Ids = { farm: string; b1: string; b2: string; b3: string; broiler: string; pullet: string };
const newIds = (): Ids => ({ farm: uuidv7(), b1: uuidv7(), b2: uuidv7(), b3: uuidv7(), broiler: uuidv7(), pullet: uuidv7() });

/** §7.1 C's facts: 182 400,00 of direct costs to 31 December, 2 000 sold, 400 dead, 7 600 counted, weighed at 2 100 g. */
async function batchOfFixtureC(ctx: TenantContext, ids: Ids) {
  const [supplier, feed, buyer] = [uuidv7(), uuidv7(), uuidv7()];
  const house = (id: string, name: string) => m("farm-registry.createHouse", { id, farmId: ids.farm, name, areaM2: 1000, capacity: 12000, type: "closed" });
  const place = (id: string, houseId: string, species: string, strainId: string, placedOn: string, chicks: number, price: string) =>
    m("flock.placeBatch", { id, houseId, species, strainId, placedOn, chicksPlaced: chicks, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: price, dayOldWeightGrams: null });
  expect(
    await statuses(
      ctx,
      m("farm-registry.createFarm", { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      house(ids.b1, "B1"),
      house(ids.b2, "B2"),
      house(ids.b3, "B3"), // empty: its share of the generator stays in the year's charges
      m("inventory.createSupplier", { id: supplier, name: "Alf", phone: null }),
      m("inventory.createStockItem", { id: feed, farmId: ids.farm, productId: null, kind: "feed", name: "Croissance", unit: "kg", lot: null, expiresOn: null }),
      m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: supplier, stockItemId: feed, day: "2025-10-25", quantity: 30_000_000, unitPriceCentimes: "480", paidCentimes: "0", dueOn: null }),
      m("sales.createBuyer", { id: buyer, name: "Hamid", phone: null, type: "trader" }),
      place(ids.broiler, ids.b1, "broiler", "ross-308", "2025-11-01", 10_000, "600"),
      place(ids.pullet, ids.b2, "pullet", "isa-brown", "2025-09-01", 5_000, "900"), // FC6: valued in the "hens" entry
      m("flock.recordDay", { batchId: ids.broiler, day: "2025-11-20", changes: { dead: 400, culled: 0, feed: { stockItemId: feed, grams: 12_500_000 } } }),
      m("flock.recordDay", { batchId: ids.broiler, day: "2025-12-20", changes: { dead: 0, culled: 0, feed: { stockItemId: feed, grams: 12_500_000 } } }),
      expense("2025-12-15", "vet_fees", "240000", { batchId: ids.broiler }),
      m("sales.recordSale", { id: uuidv7(), batchId: ids.broiler, buyerId: buyer, day: "2025-12-10", birds: 2000, farmWeightGrams: 4_000_000, buyerWeightGrams: null, pricePerKgCentimes: "850", paymentMethod: "cash", paidCentimes: "3400000", instrument: null }),
      m("flock.recordWeighing", { id: uuidv7(), batchId: ids.broiler, day: "2025-12-28", sample: { totalGrams: 105_000, count: 50 } }),
    ),
  ).toEqual(Array(15).fill("applied"));
  expect(await saveYearEndCount(ctx, { year: 2025, counts: { [ids.broiler]: "7 600" } })).toEqual({ ok: true, value: 1 });
}

/** The house B1 in the opening balance: 600 000,00 over 240 months from January 2020, 150 000,00 depreciated by 2025. */
const houseB1 = (houseId: string) => ({
  id: uuidv7(),
  label: "Bâtiment B1",
  category: "building",
  houseId,
  acquiredOn: "2020-01-01",
  inServiceOn: "2020-01-01",
  amountCentimes: "60000000",
  lifeMonths: 240,
  paidWith: null,
  opening: { on: "2025-01-01", accumulatedCentimes: "15000000" },
});

/** Every journal line of an entity, as stored. */
const allLines = (legalEntityId: string) =>
  db.journalLine.findMany({
    where: { entry: { legalEntityId } },
    select: { id: true, account: true, debitCentimes: true, creditCentimes: true, entry: { select: { id: true, day: true, sourceId: true, sourceVersion: true } } },
    orderBy: { id: "asc" },
  });
const linesOf = async (sourceId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceModule: "finance", sourceId } }, include: { entry: true }, orderBy: [{ entry: { id: "asc" } }, { debitCentimes: "desc" }] })).map((l) => [
    l.entry.day.toISOString().slice(0, 10),
    l.account,
    l.debitCentimes,
    l.creditCentimes,
  ]);

describe("the production cost of a batch in progress at the close (SPEC-finance FC4, FQ19: PCA pp. 42–43)", () => {
  let owner: TenantContext, before: TenantContext, entity: string, beforeEntity: string;
  const [a, b] = [newIds(), newIds()];
  const bank = uuidv7();

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.createMany({ data: [{ id: "ross-308", name: "Ross 308" }, { id: "isa-brown", name: "ISA Brown", productionTypes: ["pullet", "layer"] }] });
    owner = await tenant("+212600000001", "Ferme A");
    before = await tenant("+212600000002", "Ferme B");
    entity = (await listLegalEntities(owner))[0].id;
    beforeEntity = (await listLegalEntities(before))[0].id;
    // FN14 by house m², so the fixture's shares are halves.
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1, allocationKey: "houseArea" })).toMatchObject({ ok: true });
    expect(await changeAccountingChoices(before, beforeEntity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    await db.treasuryAccount.create({ data: { id: bank, organizationId: owner.organizationId, kind: "bank", name: "Banque Populaire" } });
    await batchOfFixtureC(owner, a);
    await batchOfFixtureC(before, b);
  }, 60_000); // two organisations and 30 mutations: above the 10 s hook default on a loaded Windows Docker

  it("§7.1 F: 182 400,00 direct + 5 389,49 depreciation + 600,00 indirect; 149 141,68 at cost, provision 13 481,68; FN13 keeps every charge", async () => {
    expect(
      await statuses(
        owner,
        expense("2025-12-10", "catching", "50000", { batchId: a.broiler }), // distribution: out of the production cost
        expense("2025-12-31", "electricity", "120000", { serviceMonth: "2025-12" }), // 600,00 each to the broiler and the pullets
        expense("2025-12-31", "bank_fees", "30000", { serviceMonth: "2025-12", treasuryId: bank }), // administration: out
      ),
    ).toEqual(Array(3).fill("applied"));
    expect(await createFixedAsset(owner, houseB1(a.b1), clock)).toEqual(OK);
    const farmAsset = (label: string, category: string, inService: string, amount: string, lifeMonths: number) =>
      createFixedAsset(owner, { id: uuidv7(), label, category, farmId: a.farm, acquiredOn: inService, inServiceOn: inService, amountCentimes: amount, lifeMonths, paidWith: "credit" }, clock);
    expect(await farmAsset("Groupe électrogène", "equipment", "2025-09-18", "4735000", 84)).toEqual(OK); // §7.1 A, in 2025
    expect(await farmAsset("Ordinateur", "computer", "2025-01-10", "900000", 36)).toEqual(OK); // administration: out

    const preview = await closePreview(owner, 2025, clock);
    if (!preview.ok) throw new Error(preview.error);
    const broiler = preview.value.batches.find((x) => x.id === a.broiler);
    expect(broiler).toMatchObject({ costs: { direct: 18_240_000n, depreciation: 538_949n, indirect: 60_000n }, engaged: 18_838_949n, cost: 14_914_168n, current: 13_566_000n, provision: 1_348_168n });
    expect(preview.value.entries.find((e) => e.kind === "batch")?.lines).toEqual([
      { account: "31322", label: "Animaux", debit: 14_914_168n, credit: 0n },
      { account: "71311", label: "Variation des stocks de biens produits en cours", debit: 0n, credit: 14_914_168n },
    ]);
    // FN13, the management result, still counts every charge and no depreciation: 182 400 + 500 + 600 + 150.
    const results = await batchResults(owner, "2025-12-31" as FarmDay);
    expect(results.ok && results.value.find((r) => r.id === a.broiler)?.costCentimes).toBe(18_365_000n);

    expect(await runClose(owner, { year: 2025 }, clock)).toMatchObject({ ok: true });
    expect(await linesOf(`close:batch:${entity}:2025`)).toEqual([["2025-12-31", "31322", 14_914_168n, 0n], ["2025-12-31", "71311", 0n, 14_914_168n]]);
    expect(await linesOf(`close:provision:${entity}:2025`)).toEqual([["2025-12-31", "61961", 1_348_168n, 0n], ["2025-12-31", "3913", 0n, 1_348_168n]]);
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: true, value: 0 });
  });

  it("never re-posts a year closed before this rule: the run is refused, nothing is written, its lines and the opening stay as they were", async () => {
    // 2025 closed with §7.1 C's figures (no asset, no shared charge: FN13's cost alone, as the earlier rule).
    expect(await runClose(before, { year: 2025 }, clock)).toMatchObject({ ok: true });
    expect(await closeFiscalYear(before, { year: 2025 }, clock)).toMatchObject({ ok: true });
    expect(await linesOf(`close:batch:${beforeEntity}:2025`)).toEqual([["2025-12-31", "31322", 14_440_000n, 0n], ["2025-12-31", "71311", 0n, 14_440_000n]]);
    const closed = await allLines(beforeEntity);

    // The house's depreciation would now raise the batch's cost (FQ19), and its own charge: the run would repost.
    expect(await createFixedAsset(before, houseB1(b.b1), clock)).toEqual(OK); // in the opening balance: posts nothing
    const preview = await closePreview(before, 2025, clock);
    expect(preview.ok && preview.value.batches.find((x) => x.id === b.broiler)?.costs.depreciation).toBe(501_370n);
    expect(await runClose(before, { year: 2025 }, clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await closeFiscalYear(before, { year: 2025 }, clock)).toEqual({ ok: false, error: "CLOSE_RUN_PENDING" });
    expect(await allLines(beforeEntity)).toEqual(closed);
    expect(await linesOf(`reversal:close:batch:${beforeEntity}:2025`)).toEqual([["2026-01-01", "71311", 14_440_000n, 0n], ["2026-01-01", "31322", 0n, 14_440_000n]]);
  });
});
