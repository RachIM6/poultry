import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, closeFiscalYear, closePreview, runClose, saveYearEndCount, saveYearEndValues } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

// Fiscal year 2025: flock refuses a day not yet come, so the facts after the last day (January 2026) are in the past.
const clock = fixedClock("2026-06-15T10:00:00Z");
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2025-11-05T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const STRAIN: Record<string, string> = { broiler: "ross-308", pullet: "isa-brown", layer: "isa-brown", turkey: "but-6" };
const place = (id: string, houseId: string, species: string, placedOn: string, chicks: number, price: string) =>
  m("flock.placeBatch", { id, houseId, species, strainId: STRAIN[species], placedOn, chicksPlaced: chicks, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: price, dayOldWeightGrams: null });
const house = (id: string, farmId: string, name: string) => m("farm-registry.createHouse", { id, farmId, name, areaM2: 1000, capacity: 12000, type: "closed" });
const expense = (day: string, amount: string, batchId: string) =>
  m("finance.recordExpense", { id: uuidv7(), day, category: "vet_fees", amountCentimes: amount, paidFrom: "credit", treasuryId: null, note: null, batchId, serviceMonth: null });
const sale = (batchId: string, buyerId: string, day: string, birds: number, grams: number, price: string) =>
  m("sales.recordSale", { id: uuidv7(), batchId, buyerId, day, birds, farmWeightGrams: grams, buyerWeightGrams: null, pricePerKgCentimes: price, paymentMethod: "cash", paidCentimes: String((BigInt(grams) * BigInt(price)) / 1000n), instrument: null });

/** Every line posted for a source, its versions and their cancellations: [day, account, debit, credit]. */
async function linesOf(sourceId: string) {
  const ids = (await db.journalEntry.findMany({ where: { sourceModule: "finance", sourceId }, select: { id: true } })).map((e) => e.id);
  const lines = await db.journalLine.findMany({ where: { entry: { OR: [{ id: { in: ids } }, { reversesId: { in: ids } }] } }, include: { entry: true }, orderBy: [{ entry: { id: "asc" } }, { debitCentimes: "desc" }, { account: "asc" }] });
  return lines.map((l) => [l.entry.day.toISOString().slice(0, 10), l.account, l.debitCentimes, l.creditCentimes]);
}

describe("batches in progress at the close (SPEC-finance FC4, FQ19, FQ20, T109)", () => {
  let owner: TenantContext, other: TenantContext, entity: string, otherEntity: string;
  const ids = {
    farm: uuidv7(), b1: uuidv7(), b2: uuidv7(), b3: uuidv7(), supplier: uuidv7(), feed: uuidv7(), buyer: uuidv7(), broiler: uuidv7(), pullet: uuidv7(), layer: uuidv7(),
    otherFarm: uuidv7(), otherHouse: uuidv7(), turkey: uuidv7(),
  };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.createMany({ data: [{ id: "ross-308", name: "Ross 308" }, { id: "isa-brown", name: "ISA Brown", productionTypes: ["pullet", "layer"] }, { id: "but-6", name: "BUT 6", productionTypes: ["turkey"] }] });
    owner = await tenant("+212600000001", "Ferme A");
    other = await tenant("+212600000002", "Ferme B");
    entity = (await listLegalEntities(owner))[0].id;
    otherEntity = (await listLegalEntities(other))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    expect(await changeAccountingChoices(other, otherEntity, { books: "ledger", pcaOverlay: false, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true }); // FN2: CGNC only

    // §7.1 C: 10 000 chicks at 6,00 (60 000,00), 25 t of feed eaten at 4,80 (120 000,00), 2 400,00 of vet fees:
    // 182 400,00 engaged to 31 December. 2 000 sold on 10 December at 8,50 DH/kg, 400 dead, weighed at 2 100 g.
    expect(
      await statuses(
        owner,
        m("farm-registry.createFarm", { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        house(ids.b1, ids.farm, "B1"),
        house(ids.b2, ids.farm, "B2"),
        house(ids.b3, ids.farm, "B3"),
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Croissance", unit: "kg", lot: null, expiresOn: null }),
        m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: "2025-10-25", quantity: 30_000_000, unitPriceCentimes: "480", paidCentimes: "0", dueOn: null }),
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        place(ids.broiler, ids.b1, "broiler", "2025-11-01", 10_000, "600"),
        place(ids.pullet, ids.b2, "pullet", "2025-09-01", 5_000, "900"), // FC6: in the "hens" entry, not here
        place(ids.layer, ids.b3, "layer", "2025-06-01", 4_000, "1500"),
        m("flock.recordDay", { batchId: ids.broiler, day: "2025-11-20", changes: { dead: 400, culled: 0, feed: { stockItemId: ids.feed, grams: 12_500_000 } } }),
        m("flock.recordDay", { batchId: ids.broiler, day: "2025-12-20", changes: { dead: 0, culled: 0, feed: { stockItemId: ids.feed, grams: 12_500_000 } } }),
        expense("2025-12-15", "240000", ids.broiler),
        sale(ids.broiler, ids.buyer, "2025-12-10", 2000, 4_000_000, "850"),
        m("flock.recordWeighing", { id: uuidv7(), batchId: ids.broiler, day: "2025-12-28", sample: { totalGrams: 105_000, count: 50 } }),
        // After the last day: none of these counts for 2025.
        m("flock.recordDay", { batchId: ids.broiler, day: "2026-01-03", changes: { dead: 100, culled: 0, feed: { stockItemId: ids.feed, grams: 1_000_000 } } }),
        expense("2026-01-04", "50000", ids.broiler),
        m("flock.recordWeighing", { id: uuidv7(), batchId: ids.broiler, day: "2026-01-04", sample: { totalGrams: 125_000, count: 50 } }),
        sale(ids.broiler, ids.buyer, "2026-01-05", 1000, 2_500_000, "900"),
      ),
    ).toEqual(Array(20).fill("applied"));
    // FC3: the 7 600 birds on hand counted.
    expect(await saveYearEndCount(owner, { year: 2025, counts: { [ids.broiler]: "7 600" } })).toEqual({ ok: true, value: 1 });

    // Another organisation, CGNC only: a turkey batch never weighed, no turkey sold.
    expect(
      await statuses(
        other,
        m("farm-registry.createFarm", { id: ids.otherFarm, name: "Ferme Rif", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        house(ids.otherHouse, ids.otherFarm, "D1"),
        place(ids.turkey, ids.otherHouse, "turkey", "2025-10-01", 1_000, "2500"), // 25 000,00
      ),
    ).toEqual(Array(3).fill("applied"));
  });

  it("§7.1 C: 144 400,00 at cost, current value 135 660,00, provision 8 740,00; pullets and layers listed, valued by FC6", async () => {
    const preview = await closePreview(owner, 2025, clock);
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.value.entries.slice(3)).toEqual([
      {
        kind: "batch",
        action: "post",
        lines: [
          { account: "31322", label: "Animaux", debit: 14_440_000n, credit: 0n },
          { account: "7131", label: "Variation des stocks de produits en cours", debit: 0n, credit: 14_440_000n },
        ],
      },
      {
        // FC6 classic (T115): the pullets still rearing capitalise their cost to date; the layers bought, never posted
        // here (no posting run), are not on 23711
        kind: "hens",
        action: "post",
        lines: [
          { account: "23962", label: "Immobilisations en cours - animaux", debit: 4_500_000n, credit: 0n },
          { account: "71431", label: "Immobilisations corporelles agricoles produites", debit: 0n, credit: 4_500_000n },
        ],
      },
      {
        kind: "provision",
        action: "post",
        lines: [
          { account: "6196", label: "Dotations d’exploitation aux provisions pour dépréciations de l’actif circulant", debit: 874_000n, credit: 0n },
          { account: "3913", label: "Provisions pour dépréciation des produits en cours", debit: 0n, credit: 874_000n },
        ],
      },
    ]);
    expect(preview.value.batches.map((b) => [b.houseName, b.species, b.farm, b.valued, b.onHand, b.sold, b.engaged, b.cost, b.suggested, b.current, b.provision, b.missing])).toEqual([
      ["B3", "layer", "Ferme Atlas", false, 4_000, 0, 6_000_000n, 0n, null, null, 0n, false],
      ["B2", "pullet", "Ferme Atlas", false, 5_000, 0, 4_500_000n, 0n, null, null, 0n, false],
      ["B1", "broiler", "Ferme Atlas", true, 7_600, 2_000, 18_240_000n, 14_440_000n, 13_566_000n, 13_566_000n, 874_000n, false],
    ]);

    expect(preview.value.entries[2]).toMatchObject({ kind: "stock", lines: [{ account: "3121", debit: 2_400_000n }, {}] }); // the 5 t of feed left (T108)
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: true, value: 4 });
    expect(await linesOf(`close:batch:${entity}:2025`)).toEqual([["2025-12-31", "31322", 14_440_000n, 0n], ["2025-12-31", "7131", 0n, 14_440_000n]]);
    expect(await linesOf(`close:provision:${entity}:2025`)).toEqual([["2025-12-31", "6196", 874_000n, 0n], ["2025-12-31", "3913", 0n, 874_000n]]);
    const entry = await db.journalEntry.findFirstOrThrow({ where: { sourceId: `close:batch:${entity}:2025` } });
    expect(entry).toMatchObject({ journal: "OD", label: "Encours de production : animaux", sourceVersion: 1, createdBy: owner.userId });
  });

  it("posts nothing when the close runs again with the same facts; the values are frozen with the count", async () => {
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await closePreview(owner, 2025, clock)).toMatchObject({ ok: true, value: { frozen: true, entries: [{}, {}, {}, { action: "unchanged" }, { action: "unchanged" }, { action: "unchanged" }] } });
    expect(await saveYearEndValues(owner, { year: 2025, values: { [ids.broiler]: "140 000" } })).toEqual({ ok: false, error: "COUNT_FROZEN" });
  });

  it("reverses both on the next year's first day with the year close (FCX5): D 7131 / C 31322 and D 3913 / C 7196", async () => {
    expect(await closeFiscalYear(owner, { year: 2025 }, clock)).toEqual({ ok: true, value: 4 }); // the à-nouveaux, the stock's reversal and these two
    expect(await linesOf(`reversal:close:batch:${entity}:2025`)).toEqual([["2026-01-01", "7131", 14_440_000n, 0n], ["2026-01-01", "31322", 0n, 14_440_000n]]);
    expect(await linesOf(`reversal:close:provision:${entity}:2025`)).toEqual([["2026-01-01", "3913", 874_000n, 0n], ["2026-01-01", "7196", 0n, 874_000n]]);
    const opened = await db.journalLine.findMany({ where: { entry: { sourceId: `opening:${entity}:2026-01-01` } }, select: { account: true, debitCentimes: true, creditCentimes: true } });
    expect(opened.filter((l) => l.account === "31322" || l.account === "3913").map((l) => [l.account, l.debitCentimes - l.creditCentimes]).sort()).toEqual([["31322", 14_440_000n], ["3913", -874_000n]]);
    expect(await closeFiscalYear(owner, { year: 2025 }, clock)).toEqual({ ok: true, value: 0 });
  });

  it("refuses the run while a batch with no weighing or no sale has no value; the owner's value lets it post, on 3132 with the PCA off", async () => {
    const preview = await closePreview(other, 2025, clock);
    expect(preview.ok && preview.value.batches.map((b) => [b.species, b.cost, b.suggested, b.current, b.missing])).toEqual([["turkey", 2_500_000n, null, null, true]]);
    expect(await runClose(other, { year: 2025 }, clock)).toEqual({ ok: false, error: "BATCH_VALUE_MISSING" });
    expect(await db.journalEntry.count({ where: { legalEntityId: otherEntity } })).toBe(0); // nothing posted
    expect(await closeFiscalYear(other, { year: 2025 }, clock)).toEqual({ ok: false, error: "CLOSE_RUN_PENDING" });

    // The owner's value: owner only, a meat batch of this organisation only, audited.
    for (const role of ["manager", "accountant", "worker"] as const) {
      expect(await saveYearEndValues({ ...other, role }, { year: 2025, values: { [ids.turkey]: "24 000" } }), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(await saveYearEndValues(other, { year: 2025, values: { [ids.broiler]: "24 000" } })).toEqual({ ok: false, error: "INVALID_INPUT" }); // not its batch
    expect(await saveYearEndValues(owner, { year: 2026, values: { [ids.pullet]: "24 000" } })).toEqual({ ok: false, error: "INVALID_INPUT" }); // not a meat batch; classic hens take no value
    expect(await saveYearEndValues(other, { year: 2025, values: { [ids.turkey]: "24 000" } })).toEqual({ ok: true, value: 1 });
    expect(await db.yearEndValue.findFirst({ where: { organizationId: other.organizationId }, select: { kind: true, subjectId: true, valueCentimes: true } })).toEqual({ kind: "batch", subjectId: ids.turkey, valueCentimes: 2_400_000n });
    expect(await db.auditEvent.count({ where: { entity: "YearEndValue", organizationId: other.organizationId, action: "create" } })).toBe(1);

    expect(await runClose(other, { year: 2025 }, clock)).toEqual({ ok: true, value: 2 });
    expect(await linesOf(`close:batch:${otherEntity}:2025`)).toEqual([["2025-12-31", "3132", 2_500_000n, 0n], ["2025-12-31", "7131", 0n, 2_500_000n]]); // 31322's CGNC fallback
    expect(await linesOf(`close:provision:${otherEntity}:2025`)).toEqual([["2025-12-31", "6196", 100_000n, 0n], ["2025-12-31", "3913", 0n, 100_000n]]);
    expect(await linesOf(`close:batch:${entity}:2025`)).toHaveLength(2); // each organisation its own batches
  });
});
