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

// FCX4: facts of the last day synced after the run posted. A line they bring with no value must still take one,
// else the run (value missing), the year close (run pending) and the value (count frozen) refuse each other forever.
const clock = fixedClock("2026-06-15T10:00:00Z");
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2025-11-05T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const house = (id: string, farmId: string, name: string) => m("farm-registry.createHouse", { id, farmId, name, areaM2: 1000, capacity: 12000, type: "closed" });
const place = (id: string, houseId: string, species: string, strainId: string, placedOn: string, chicks: number, price: string, ageAtPlacementDays?: number) =>
  m("flock.placeBatch", { id, houseId, species, strainId, placedOn, chicksPlaced: chicks, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: price, dayOldWeightGrams: null, ...(ageAtPlacementDays ? { ageAtPlacementDays } : {}) });

/** Every line posted for a source, its versions and their cancellations: [account, debit, credit]. */
async function linesOf(sourceId: string) {
  const ids = (await db.journalEntry.findMany({ where: { sourceModule: "finance", sourceId }, select: { id: true } })).map((e) => e.id);
  const lines = await db.journalLine.findMany({ where: { entry: { OR: [{ id: { in: ids } }, { reversesId: { in: ids } }] } }, include: { entry: true }, orderBy: [{ entry: { id: "asc" } }, { debitCentimes: "desc" }, { account: "asc" }] });
  return lines.map((l) => [l.account, l.debitCentimes, l.creditCentimes]);
}

describe("a line with no value appearing after the close run posted (SPEC-finance FCX4, FC4, FC5)", () => {
  let owner: TenantContext, entity: string;
  const ids = { farm: uuidv7(), b1: uuidv7(), b2: uuidv7(), b3: uuidv7(), buyer: uuidv7(), broiler: uuidv7(), layers: uuidv7(), turkey: uuidv7() };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.createMany({ data: [{ id: "ross-308", name: "Ross 308" }, { id: "isa-brown", name: "ISA Brown", productionTypes: ["pullet", "layer"] }, { id: "but-6", name: "BUT 6", productionTypes: ["turkey"] }] });
    owner = await tenant("+212600000001", "Ferme A");
    entity = (await listLegalEntities(owner))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    // 1 000 broilers at 6,00; 200 sold on 10 December, weighed at 2 000 g: 800 on hand at 4 800,00, suggested 13 600,00.
    // Layers laying no egg yet in 2025: the farm has no eggs line when the run posts.
    expect(
      await statuses(
        owner,
        m("farm-registry.createFarm", { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        house(ids.b1, ids.farm, "B1"),
        house(ids.b2, ids.farm, "B2"),
        house(ids.b3, ids.farm, "B3"),
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        place(ids.broiler, ids.b1, "broiler", "ross-308", "2025-11-01", 1_000, "600"),
        place(ids.layers, ids.b2, "layer", "isa-brown", "2025-06-01", 4_000, "0", 120),
        m("sales.recordSale", { id: uuidv7(), batchId: ids.broiler, buyerId: ids.buyer, day: "2025-12-10", birds: 200, farmWeightGrams: 400_000, buyerWeightGrams: null, pricePerKgCentimes: "850", paymentMethod: "cash", paidCentimes: "340000", instrument: null }),
        m("flock.recordWeighing", { id: uuidv7(), batchId: ids.broiler, day: "2025-12-28", sample: { totalGrams: 100_000, count: 50 } }),
      ),
    ).toEqual(Array(9).fill("applied"));
  }, 60_000);

  it("takes the value of a line now missing, so the run posts again and the year closes; every other value stays frozen", async () => {
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: true, value: 1 }); // the batch entry alone
    expect(await linesOf(`close:batch:${entity}:2025`)).toEqual([["31322", 480_000n, 0n], ["71311", 0n, 480_000n]]);

    // Synced after the run: a turkey batch placed on the last day (no weighing, no sale) and 500 eggs collected that day.
    expect(await statuses(owner, place(ids.turkey, ids.b3, "turkey", "but-6", "2025-12-31", 100, "2500"), m("eggs.recordCollection", { id: uuidv7(), batchId: ids.layers, day: "2025-12-31", counts: { normal: 500, cracked: 0, dirty: 0, doubleYolk: 0, floor: 0, broken: 0 }, sample: null }))).toEqual(["applied", "applied"]);
    const late = await closePreview(owner, 2025, clock);
    if (!late.ok) throw new Error(late.error);
    expect(late.value.frozen).toBe(true);
    expect(Object.fromEntries(late.value.batches.map((b) => [b.species, [b.cost, b.current, b.missing]]))).toEqual({ turkey: [250_000n, null, true], layer: [0n, null, false], broiler: [480_000n, 1_360_000n, false] });
    expect(late.value.eggs).toMatchObject([{ farm: "Ferme Atlas", quantity: 500, perEgg: null, missing: true }]);
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: false, error: "BATCH_VALUE_MISSING" });
    expect(await closeFiscalYear(owner, { year: 2025 }, clock)).toEqual({ ok: false, error: "CLOSE_RUN_PENDING" });

    // Still frozen: a line that isn't missing, a mix with one (nothing saved), and the count.
    expect(await saveYearEndValues(owner, { year: 2025, values: { [ids.broiler]: "12 000" } })).toEqual({ ok: false, error: "COUNT_FROZEN" });
    expect(await saveYearEndValues(owner, { year: 2025, values: { [ids.turkey]: "2 000", [ids.broiler]: "12 000" } })).toEqual({ ok: false, error: "COUNT_FROZEN" });
    expect(await saveYearEndCount(owner, { year: 2025, counts: { [ids.turkey]: "90" } })).toEqual({ ok: false, error: "COUNT_FROZEN" });
    expect(await db.yearEndValue.count({ where: { organizationId: owner.organizationId } })).toBe(0);

    // The batch's value: taken once, then frozen like the others.
    expect(await saveYearEndValues(owner, { year: 2025, values: { [ids.turkey]: "2 000" } })).toEqual({ ok: true, value: 1 });
    expect(await saveYearEndValues(owner, { year: 2025, values: { [ids.turkey]: "2 100" } })).toEqual({ ok: false, error: "COUNT_FROZEN" });
    expect(await saveYearEndValues(owner, { year: 2025, values: { [ids.turkey]: "" } })).toEqual({ ok: false, error: "COUNT_FROZEN" });
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: false, error: "EGG_VALUE_MISSING" });

    // The eggs' value per egg: the same.
    expect(await saveYearEndValues(owner, { year: 2025, values: { [ids.farm]: "0,90" } })).toEqual({ ok: true, value: 1 });
    expect(await saveYearEndValues(owner, { year: 2025, values: { [ids.farm]: "1,00" } })).toEqual({ ok: false, error: "COUNT_FROZEN" });
    expect(await db.auditEvent.count({ where: { entity: "YearEndValue", organizationId: owner.organizationId, action: "create" } })).toBe(2);

    // The run posts the batch's reversal and version 2, the provision and the eggs; then the year closes.
    expect(await runClose(owner, { year: 2025 }, clock)).toEqual({ ok: true, value: 4 });
    expect(await linesOf(`close:batch:${entity}:2025`)).toEqual([
      ["31322", 480_000n, 0n],
      ["71311", 0n, 480_000n],
      ["71311", 480_000n, 0n], // Annulation
      ["31322", 0n, 480_000n],
      ["31322", 730_000n, 0n], // version 2: 4 800,00 + 2 500,00
      ["71311", 0n, 730_000n],
    ]);
    expect(await linesOf(`close:provision:${entity}:2025`)).toEqual([["61961", 50_000n, 0n], ["3913", 0n, 50_000n]]); // 2 500,00 − 2 000,00
    expect(await linesOf(`close:stock:${entity}:2025`)).toEqual([["3152", 45_000n, 0n], ["71321", 0n, 45_000n]]); // 500 × 0,90
    expect(await closeFiscalYear(owner, { year: 2025 }, clock)).toMatchObject({ ok: true });
  });
});
