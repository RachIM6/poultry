import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { eggStockOnDay } from "@/modules/eggs";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, closeFiscalYear, closePreview, runClose, saveYearEndCount, saveYearEndValues, yearEndCount } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

// Fiscal year 2025: eggs refuse a collection on a day not yet come, so the facts after the last day are in the past.
const clock = fixedClock("2026-06-15T10:00:00Z");
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2025-11-05T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const counts = (normal: number, cracked = 0) => ({ normal, cracked, dirty: 0, doubleYolk: 0, floor: 0, broken: 0 });
/** A farm with a layer house and batch: createFarm, createHouse, placeBatch. */
const layerFarm = (farmId: string, houseId: string, batchId: string, name: string) => [
  m("farm-registry.createFarm", { id: farmId, name, region: "R", province: "P", commune: "C", gps: null, onssa: null }),
  m("farm-registry.createHouse", { id: houseId, farmId, name: "P1", areaM2: 1000, capacity: 6000, type: "closed" }),
  m("flock.placeBatch", { id: batchId, houseId, species: "layer", strainId: "isa-brown", placedOn: "2025-06-01", chicksPlaced: 4000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 120 }),
];
const collect = (batchId: string, day: string, normal: number, cracked = 0) => m("eggs.recordCollection", { id: uuidv7(), batchId, day, counts: counts(normal, cracked), sample: null });

/** Every line posted for a source, its versions and their cancellations: [day, account, debit, credit]. */
async function linesOf(sourceId: string) {
  const ids = (await db.journalEntry.findMany({ where: { sourceModule: "finance", sourceId }, select: { id: true } })).map((e) => e.id);
  const lines = await db.journalLine.findMany({ where: { entry: { OR: [{ id: { in: ids } }, { reversesId: { in: ids } }] } }, include: { entry: true }, orderBy: [{ entry: { id: "asc" } }, { debitCentimes: "desc" }, { account: "asc" }] });
  return lines.map((l) => [l.entry.day.toISOString().slice(0, 10), l.account, l.debitCentimes, l.creditCentimes]);
}

describe("eggs at the close (SPEC-finance FC5, FQ18, T113)", () => {
  let owner: TenantContext, other: TenantContext, cashBook: TenantContext, entity: string, otherEntity: string;
  const ids = { farm: uuidv7(), house: uuidv7(), layers: uuidv7(), discard: uuidv7(), otherFarm: uuidv7(), otherHouse: uuidv7(), otherLayers: uuidv7(), cbFarm: uuidv7(), cbHouse: uuidv7(), cbLayers: uuidv7() };
  const lastDay = "2025-12-31" as FarmDay;
  /** The count sheet's eggs lines, by farm name. */
  const eggLinesOf = async (ctx: TenantContext) => {
    const sheet = await yearEndCount(ctx, 2025, clock);
    if (!sheet.ok) throw new Error(sheet.error);
    return sheet.value.farms.flatMap((f) => f.lines.filter((l) => l.kind === "eggs").map((l) => [f.name, l]));
  };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "isa-brown", name: "ISA Brown", productionTypes: ["pullet", "layer"] } });
    owner = await tenant("+212600000001", "Ferme A");
    other = await tenant("+212600000002", "Ferme B");
    cashBook = await tenant("+212600000003", "Ferme C"); // an individual's default: cash_book, no close (FCX4)
    entity = (await listLegalEntities(owner))[0].id;
    otherEntity = (await listLegalEntities(other))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    expect(await changeAccountingChoices(other, otherEntity, { books: "ledger", pcaOverlay: false, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true }); // FN2: CGNC only

    expect(
      await statuses(
        owner,
        ...layerFarm(ids.farm, ids.house, ids.layers, "Ferme Atlas"),
        collect(ids.layers, "2025-12-20", 1000, 20), // 1 000 ungraded, 20 downgraded
        collect(ids.layers, "2025-12-31", 980),
        collect(ids.layers, "2026-01-02", 990), // laid after the last day
        m("eggs.discardEggs", { id: ids.discard, batchId: ids.layers, laidOn: "2025-12-20", item: "downgraded", eggs: 20, reason: "Fêlés" }),
      ),
    ).toEqual(Array(7).fill("applied"));
    expect(await statuses(other, ...layerFarm(ids.otherFarm, ids.otherHouse, ids.otherLayers, "Ferme Rif"), collect(ids.otherLayers, "2025-12-30", 600))).toEqual(Array(4).fill("applied"));
    expect(await statuses(cashBook, ...layerFarm(ids.cbFarm, ids.cbHouse, ids.cbLayers, "Ferme Souss"), collect(ids.cbLayers, "2025-12-30", 700))).toEqual(Array(4).fill("applied"));
  }, 60_000); // three organisations and 15 mutations: above the 10 s hook default on a loaded Windows Docker

  it("puts each farm's eggs on the count sheet with eggs' stock on the last day: laid by then, discarded by then", async () => {
    // The discard came from a phone without its day: the server's (2026): the 20 cracked eggs were still there on 31 December 2025.
    expect(await eggStockOnDay(db, owner, lastDay)).toEqual([{ farmId: ids.farm, eggs: 2000 }]);
    await db.eggDiscard.update({ where: { id: ids.discard }, data: { day: new Date("2025-12-31") } }); // discarded on the last day
    expect(await eggStockOnDay(db, owner, lastDay)).toEqual([{ farmId: ids.farm, eggs: 1980 }]);
    expect(await eggStockOnDay(db, owner, "2026-12-31" as FarmDay)).toEqual([{ farmId: ids.farm, eggs: 2970 }]);
    expect(await eggStockOnDay(db, owner, "2025-12-19" as FarmDay)).toEqual([]);

    expect(await eggLinesOf(owner)).toEqual([["Ferme Atlas", { kind: "eggs", id: ids.farm, farmId: ids.farm, book: 1980, counted: null, gap: null }]]); // after the layer batch's line
    // Counted, audited, and each organisation its own.
    expect(await saveYearEndCount(owner, { year: 2025, counts: { [ids.farm]: "1 950" } })).toEqual({ ok: true, value: 1 });
    expect(await eggLinesOf(owner)).toMatchObject([["Ferme Atlas", { counted: 1950, gap: -30 }]]);
    expect(await db.yearEndCount.findFirstOrThrow({ where: { subjectId: ids.farm } })).toMatchObject({ kind: "eggs", quantity: 1950 });
    expect(await saveYearEndCount(other, { year: 2025, counts: { [ids.farm]: "10" } })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveYearEndCount(owner, { year: 2025, counts: { [ids.farm]: "12,5" } })).toEqual({ ok: false, error: "INVALID_INPUT" }); // whole eggs
  });

  it("counts a discard and a sale on the farm day they happened, not the day they were synced", async () => {
    const late = await tenant("+212600000004", "Ferme D");
    const x = { farm: uuidv7(), house: uuidv7(), layers: uuidv7(), buyer: uuidv7() };
    const discard = (eggs: number, day: string) => m("eggs.discardEggs", { id: uuidv7(), batchId: x.layers, laidOn: "2025-12-30", item: "ungraded", eggs, reason: "Cassés", day });
    expect(
      await statuses(
        late,
        ...layerFarm(x.farm, x.house, x.layers, "Ferme Doukkala"),
        collect(x.layers, "2025-12-30", 1000),
        m("sales.createBuyer", { id: x.buyer, name: "Grossiste", phone: null, type: "trader" }),
        discard(50, "2025-12-31"),
        m("sales.recordEggSale", { id: uuidv7(), batchId: x.layers, buyerId: x.buyer, day: "2025-12-31", lines: [{ item: "ungraded", eggs: 300, unitPriceCentimes: "3000" }], paymentMethod: "credit", paidCentimes: "0", instrument: null }),
        discard(20, "2026-01-02"),
      ),
    ).toEqual(Array(8).fill("applied"));
    // The phone was offline over the new year: all three reached the server on 2 January.
    const synced = { createdAt: new Date("2026-01-02T09:00:00Z") };
    await db.eggDiscard.updateMany({ where: { organizationId: late.organizationId }, data: synced });
    await db.eggDraw.updateMany({ where: { organizationId: late.organizationId }, data: synced });
    expect(await eggStockOnDay(db, late, lastDay)).toEqual([{ farmId: x.farm, eggs: 650 }]); // 1 000 − 50 − 300: the 20 of 2 January were still there
    expect(await eggStockOnDay(db, late, "2026-01-02" as FarmDay)).toEqual([{ farmId: x.farm, eggs: 630 }]);
    expect(await statuses(late, discard(1, "2025-12-29"), discard(1, "2099-01-01"))).toEqual(["errors.INVALID_INPUT", "errors.DAY_IN_FUTURE"]); // before the laying day; not yet come
  });

  it("refuses the run while eggs have no value per egg; values the counted eggs, none when counted 0", async () => {
    expect(await closePreview(owner, 2025, clock)).toMatchObject({ ok: true, value: { eggs: [{ farm: "Ferme Atlas", book: 1980, quantity: 1950, perEgg: null, value: 0n, posted: true, missing: true }] } });
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: false, error: "EGG_VALUE_MISSING" });
    expect(await closeFiscalYear(owner, { year: 2025 }, clock)).toEqual({ ok: false, error: "CLOSE_RUN_PENDING" });
    expect(await db.journalEntry.count({ where: { legalEntityId: entity } })).toBe(0);

    for (const role of ["manager", "accountant", "worker"] as const) expect(await saveYearEndValues({ ...owner, role }, { year: 2025, values: { [ids.farm]: "0,95" } }), role).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await saveYearEndValues(owner, { year: 2025, values: { [ids.farm]: "0,955" } })).toEqual({ ok: false, error: "INVALID_INPUT" }); // to the centime
    expect(await saveYearEndValues(owner, { year: 2025, values: { [ids.farm]: "0,95" } })).toEqual({ ok: true, value: 1 });
    expect(await db.yearEndValue.findFirstOrThrow({ where: { subjectId: ids.farm } })).toMatchObject({ kind: "eggs", valueCentimes: 95n });
    const counted = await closePreview(owner, 2025, clock);
    expect(counted).toMatchObject({ ok: true, value: { eggs: [{ quantity: 1950, perEgg: 95n, value: 185_250n, missing: false }] } });
    expect(counted.ok && counted.value.entries.find((e) => e.kind === "stock")).toEqual({
      kind: "stock",
      action: "post",
      lines: [
        { account: "3152", label: "Produits finis (d’animaux)", debit: 185_250n, credit: 0n }, // 1 950 × 0,95
        { account: "71321", label: "Variation des stocks de produits finis", debit: 0n, credit: 185_250n },
      ],
    });
    expect(await saveYearEndCount(owner, { year: 2025, counts: { [ids.farm]: "0" } })).toEqual({ ok: true, value: 1 });
    const none = await closePreview(owner, 2025, clock);
    expect(none).toMatchObject({ ok: true, value: { eggs: [{ quantity: 0, value: 0n, missing: false }] } });
    expect(none.ok && none.value.entries.find((e) => e.kind === "stock")).toEqual({ kind: "stock", action: "none", lines: [] });
    expect(await saveYearEndCount(owner, { year: 2025, counts: { [ids.farm]: "" } })).toEqual({ ok: true, value: 1 }); // back to the book: 1 980
  });

  it("posts D 3152 / C 71321 in the stock entry; the same facts post nothing, changed ones a reversal and a new version", async () => {
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: true, value: 1 });
    expect(await linesOf(`close:stock:${entity}:2025`)).toEqual([["2025-12-31", "3152", 188_100n, 0n], ["2025-12-31", "71321", 0n, 188_100n]]); // 1 980 × 0,95
    expect(await db.journalEntry.findFirstOrThrow({ where: { sourceId: `close:stock:${entity}:2025` } })).toMatchObject({ journal: "OD", label: "Stocks de fin d’exercice", sourceVersion: 1 });
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await saveYearEndValues(owner, { year: 2025, values: { [ids.farm]: "1,00" } })).toEqual({ ok: false, error: "COUNT_FROZEN" });

    // A collection of the last day entered late: the books now hold 2 080 eggs on 31 December.
    expect(await statuses(owner, collect(ids.layers, "2025-12-31", 100))).toEqual(["applied"]);
    expect(await closePreview(owner, 2025, clock)).toMatchObject({ ok: true, value: { entries: [{}, {}, { kind: "stock", action: "repost" }, {}, {}, {}] } });
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: true, value: 2 });
    expect(await linesOf(`close:stock:${entity}:2025`)).toEqual([
      ["2025-12-31", "3152", 188_100n, 0n],
      ["2025-12-31", "71321", 0n, 188_100n],
      ["2025-12-31", "71321", 188_100n, 0n], // Annulation
      ["2025-12-31", "3152", 0n, 188_100n],
      ["2025-12-31", "3152", 197_600n, 0n], // version 2: 2 080 × 0,95
      ["2025-12-31", "71321", 0n, 197_600n],
    ]);
  });

  it("reverses the eggs on the next year's first day with the year close (FCX5)", async () => {
    expect(await closeFiscalYear(owner, { year: 2025 }, clock)).toEqual({ ok: true, value: 2 }); // the à-nouveaux and the stock reversal
    expect(await linesOf(`reversal:close:stock:${entity}:2025`)).toEqual([["2026-01-01", "71321", 197_600n, 0n], ["2026-01-01", "3152", 0n, 197_600n]]);
    const opened = await db.journalLine.findMany({ where: { entry: { sourceId: `opening:${entity}:2026-01-01` }, account: "3152" }, select: { debitCentimes: true, creditCentimes: true } });
    expect(opened).toEqual([{ debitCentimes: 197_600n, creditCentimes: 0n }]);
    expect(await closeFiscalYear(owner, { year: 2025 }, clock)).toEqual({ ok: true, value: 0 });
  });

  it("with the PCA off, lists the eggs but posts nothing for them and needs no value (FQ25: 3152 lands on 315, which has sub-accounts)", async () => {
    expect(await closePreview(other, 2025, clock)).toMatchObject({ ok: true, value: { eggs: [{ farm: "Ferme Rif", quantity: 600, posted: false, missing: false, value: 0n }] } });
    expect(await saveYearEndValues(other, { year: 2025, values: { [ids.otherFarm]: "0,90" } })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveYearEndValues(other, { year: 2025, values: { [ids.farm]: "0,90" } })).toEqual({ ok: false, error: "INVALID_INPUT" }); // not its farm
    expect(await runClose(other, { year: 2025 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await db.journalLine.count({ where: { entry: { legalEntityId: otherEntity }, account: { in: ["3152", "315", "71321"] } } })).toBe(0);
  });

  it("keeps a cash_book entity without a close: its eggs are counted, nothing is valued or posted (FCX4)", async () => {
    expect(await eggLinesOf(cashBook)).toMatchObject([["Ferme Souss", { book: 700 }]]);
    expect(await closePreview(cashBook, 2025, clock)).toMatchObject({ ok: true, value: { books: "cash_book", eggs: [], entries: [] } });
    expect(await runClose(cashBook, { year: 2025 }, clock)).toEqual({ ok: false, error: "CASH_BOOK_NO_CLOSE" });
  });
});
