import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, closePreview, postPending, runClose, saveHensSchedules, saveYearEndCount, saveYearEndValues } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

// SPEC-finance FC6 (T114, T115): laying hens and pullets, classic and simplified. Fiscal years 2025 and 2026, run in 2027.
const clock = fixedClock("2027-06-15T10:00:00Z");
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2025-11-05T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const farm = (id: string, name: string) => m("farm-registry.createFarm", { id, name, region: "R", province: "P", commune: "C", gps: null, onssa: null });
const house = (id: string, farmId: string, name: string) => m("farm-registry.createHouse", { id, farmId, name, areaM2: 1000, capacity: 12000, type: "closed" });
const place = (id: string, houseId: string, species: string, placedOn: string, chicks: number, price: string, age = 0) =>
  m("flock.placeBatch", { id, houseId, species, strainId: "isa-brown", placedOn, chicksPlaced: chicks, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: price, dayOldWeightGrams: null, ageAtPlacementDays: age });

/** The lines of a source's standing version, sorted: [account, debit, credit]. */
async function standing(module: string, sourceId: string) {
  const entries = await db.journalEntry.findMany({ where: { sourceModule: module, sourceId }, orderBy: { sourceVersion: "desc" }, include: { lines: true } });
  const live = entries.find((e) => !entries.some((x) => x.reversesId === e.id));
  return (live?.lines ?? []).map((l) => [l.account, l.debitCentimes, l.creditCentimes]).sort((a, b) => String(a).localeCompare(String(b)));
}

describe("laying hens and pullets (SPEC-finance FC6, T114, T115)", () => {
  let classic: TenantContext, simplified: TenantContext, cgnc: TenantContext;
  let classicEntity: string, simplifiedEntity: string;
  const ids = {
    farm: uuidv7(), rearing: uuidv7(), laying: uuidv7(), bought: uuidv7(), pullets: uuidv7(), hens: uuidv7(), ready: uuidv7(), buyer: uuidv7(),
    sFarm: uuidv7(), sLaying: uuidv7(), sRearing: uuidv7(), sHens: uuidv7(), sPullets: uuidv7(), cFarm: uuidv7(), cHouse: uuidv7(), cPullets: uuidv7(),
  };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "isa-brown", name: "ISA Brown", productionTypes: ["pullet", "layer"] } });
    classic = await tenant("+212600000011", "Ferme Classique");
    simplified = await tenant("+212600000012", "Ferme Simple");
    cgnc = await tenant("+212600000013", "Ferme CGNC");
    classicEntity = (await listLegalEntities(classic))[0].id;
    simplifiedEntity = (await listLegalEntities(simplified))[0].id;
    expect(await changeAccountingChoices(classic, classicEntity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true }); // classic by default (FQ7a)
    expect(await changeAccountingChoices(simplified, simplifiedEntity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1, hensMethod: "simplified" })).toMatchObject({ ok: true });
    expect(await changeAccountingChoices(cgnc, (await listLegalEntities(cgnc))[0].id, { books: "ledger", pcaOverlay: false, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
  });

  it("stores the method with the accounting choices, audited (FQ7a)", async () => {
    expect((await listLegalEntities(classic))[0].hensMethod).toBe("classic");
    expect((await listLegalEntities(simplified))[0].hensMethod).toBe("simplified");
    const audited = await db.auditEvent.findFirstOrThrow({ where: { organizationId: simplified.organizationId, entity: "LegalEntity", action: "update" }, orderBy: { id: "desc" } });
    expect(audited.after).toMatchObject({ hensMethod: "simplified" });
  });

  it("classic: capitalises the pullets still rearing at the year end, D 23962 / C 71431 at their FN13 cost", async () => {
    // 1 000 pullets at 9,00 (9 000,00) on 1 October 2025
    expect(await statuses(classic, farm(ids.farm, "Ferme Atlas"), house(ids.rearing, ids.farm, "P1"), house(ids.laying, ids.farm, "L1"), house(ids.bought, ids.farm, "L2"), place(ids.pullets, ids.rearing, "pullet", "2025-10-01", 1000, "900"))).toEqual(
      Array(5).fill("applied"),
    );
    expect(await runClose(classic, { year: 2025 }, clock)).toEqual({ ok: true, value: 1 });
    expect(await standing("finance", `close:hens:${classicEntity}:2025`)).toEqual([
      ["23962", 900_000n, 0n],
      ["71431", 0n, 900_000n],
    ]);
  });

  it("classic: at the transfer to lay, capitalises the rest and clears 23962 into 23711 (FQ7c); point-of-lay hens bought go on 23711", async () => {
    // 1 000,00 of vet fees in 2026, then the transfer on 1 March; 500 point-of-lay hens bought at 60,00 on 1 April
    expect(
      await statuses(
        classic,
        m("finance.recordExpense", { id: uuidv7(), day: "2026-02-01", category: "vet_fees", amountCentimes: "100000", paidFrom: "credit", treasuryId: null, note: null, batchId: ids.pullets, serviceMonth: null }),
        m("flock.transferToLaying", { batchId: ids.pullets, day: "2026-03-01", newBatchId: ids.hens, houseId: ids.laying, hens: 1000 }),
        place(ids.ready, ids.bought, "layer", "2026-04-01", 500, "6000", 120),
      ),
    ).toEqual(Array(3).fill("applied"));
    await postPending(classic);
    expect(await standing("flock", `lay:${ids.hens}`)).toEqual([
      ["23711", 1_000_000n, 0n],
      ["23962", 0n, 1_000_000n],
      ["23962", 100_000n, 0n],
      ["71431", 0n, 100_000n],
    ]);
    expect(await standing("flock", ids.ready)).toEqual([
      ["23711", 3_000_000n, 0n],
      ["4481", 0n, 3_000_000n],
    ]);
    expect(await standing("flock", ids.pullets)).toEqual([
      ["4411", 0n, 900_000n],
      ["612121", 900_000n, 0n],
    ]); // the pullets' chicks stay a charge, capitalised through 71431
    await postPending(classic);
    expect(await db.journalEntry.count({ where: { sourceModule: "flock", sourceId: `lay:${ids.hens}` } })).toBe(1); // once per batch
  });

  it("classic: culled hens sold go to 7187, not 712121", async () => {
    expect(
      await statuses(
        classic,
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        m("sales.recordSale", { id: uuidv7(), batchId: ids.hens, buyerId: ids.buyer, day: "2026-09-15", birds: 250, farmWeightGrams: 500_000, buyerWeightGrams: null, pricePerKgCentimes: "1000", paymentMethod: "credit", paidCentimes: "0", instrument: null }),
      ),
    ).toEqual(["applied", "applied"]);
    await postPending(classic);
    const lines = await db.journalLine.findMany({ where: { entry: { legalEntityId: classicEntity, journal: "VT" } }, select: { account: true, creditCentimes: true } });
    expect(lines.filter((l) => l.creditCentimes > 0n)).toEqual([{ account: "7187", creditCentimes: 500_000n }]);
  });

  it("classic: refuses the run until each laying flock has its life and cull value, owner only, audited", async () => {
    const preview = await closePreview(classic, 2026, clock);
    expect(preview.ok && preview.value.hens).toMatchObject({ method: "classic", lines: expect.arrayContaining([expect.objectContaining({ id: ids.hens, entry: 1_000_000n, missing: true })]) });
    expect(await runClose(classic, { year: 2026 }, clock)).toEqual({ ok: false, error: "HENS_VALUE_MISSING" });
    for (const role of ["manager", "accountant", "worker"] as const) {
      expect(await saveHensSchedules({ ...classic, role }, { year: 2026, values: { [ids.hens]: { life: "14", cull: "4 000" } } }), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(await saveHensSchedules(classic, { year: 2026, values: { [ids.hens]: { life: "14", cull: "10 001" } } })).toEqual({ ok: false, error: "INVALID_INPUT" }); // above the entry value
    expect(await saveHensSchedules(classic, { year: 2026, values: { [ids.hens]: { life: "0", cull: "4 000" } } })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveHensSchedules(simplified, { year: 2026, values: { [ids.hens]: { life: "14", cull: "4 000" } } })).toEqual({ ok: false, error: "INVALID_INPUT" }); // another organisation's
    expect(
      await saveHensSchedules(classic, {
        year: 2026,
        values: { [ids.hens]: { life: "14", cull: "4 000" }, [ids.ready]: { life: "12", cull: "6 000" } },
      }),
    ).toEqual({ ok: true, value: 2 });
    expect(await db.auditEvent.count({ where: { organizationId: classic.organizationId, entity: "HensSchedule", action: "create" } })).toBe(2);
  });

  it("classic: posts the year's charge and the cull's removal, D 61937 / C 28371 and D 28371 + D 6187 / C 23711 (FQ8)", async () => {
    // Transferred flock: 10 000,00 − 4 000,00 over 14 months from March. March–August on the whole flock: 6 000 × 6 ÷ 14 →
    // 2 571,43; a quarter sold on 15 September (gross 2 500,00, accumulated 642,86, net book value 1 857,14); September–
    // December on the rest: (7 500 − 3 000 − 1 928,57) × 4 ÷ 8 → 1 285,72. Bought flock: (30 000 − 6 000) × 9 ÷ 12 = 18 000,00.
    expect(await runClose(classic, { year: 2026 }, clock)).toEqual({ ok: true, value: 1 });
    expect(await standing("finance", `close:hens:${classicEntity}:2026`)).toEqual([
      ["23711", 0n, 250_000n],
      ["28371", 0n, 2_185_715n],
      ["28371", 64_286n, 0n],
      ["6187", 185_714n, 0n],
      ["61937", 2_185_715n, 0n],
    ]);
    expect(await runClose(classic, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 }); // FN7: same figures
    expect(await saveHensSchedules(classic, { year: 2026, values: { [ids.hens]: { life: "16", cull: "4 000" } } })).toEqual({ ok: false, error: "COUNT_FROZEN" });
  });

  it("simplified: values the birds counted at entry value, reverses the previous year's, provisions below the current value (T114)", async () => {
    // 4 000 hens bought at 15,00 (60 000,00) and 1 000 pullets at 9,00; 3 800 hens counted
    expect(
      await statuses(
        simplified,
        farm(ids.sFarm, "Ferme Souss"),
        house(ids.sLaying, ids.sFarm, "L1"),
        house(ids.sRearing, ids.sFarm, "P1"),
        place(ids.sHens, ids.sLaying, "layer", "2025-06-01", 4000, "1500", 120),
        place(ids.sPullets, ids.sRearing, "pullet", "2025-09-01", 1000, "900"),
      ),
    ).toEqual(Array(5).fill("applied"));
    await postPending(simplified);
    expect(await standing("flock", ids.sHens)).toEqual([
      ["4411", 0n, 6_000_000n],
      ["612121", 6_000_000n, 0n],
    ]); // bought as a charge (p. 131)
    expect(await saveYearEndCount(simplified, { year: 2025, counts: { [ids.sHens]: "3 800" } })).toEqual({ ok: true, value: 1 });
    const preview = await closePreview(simplified, 2025, clock);
    expect(preview.ok && preview.value.hens.lines.map((h) => [h.species, h.onHand, h.value, h.missing]).sort()).toEqual([
      ["layer", 3800, 5_700_000n, true],
      ["pullet", 1000, 900_000n, true],
    ]);
    expect(await runClose(simplified, { year: 2025 }, clock)).toEqual({ ok: false, error: "HENS_VALUE_MISSING" });
    expect(await saveYearEndValues(simplified, { year: 2025, values: { [ids.sHens]: "14", [ids.sPullets]: "9,50" } })).toEqual({ ok: true, value: 2 }); // per bird
    expect(await runClose(simplified, { year: 2025 }, clock)).toEqual({ ok: true, value: 1 });
    expect(await standing("finance", `close:hens:${simplifiedEntity}:2025`)).toEqual([
      ["23711", 5_700_000n, 0n],
      ["23712", 900_000n, 0n],
      ["2937", 0n, 380_000n], // 5 700,00 − 3 800 × 14,00
      ["61943", 380_000n, 0n],
      ["7151", 0n, 5_700_000n],
      ["7152", 0n, 900_000n],
    ]);

    // 2026: the 4 000 hens in the books, worth more than their entry value now; last year's value and provision reversed
    expect(await saveYearEndValues(simplified, { year: 2026, values: { [ids.sHens]: "16", [ids.sPullets]: "10" } })).toEqual({ ok: true, value: 2 });
    expect(await runClose(simplified, { year: 2026 }, clock)).toEqual({ ok: true, value: 1 });
    expect(await standing("finance", `close:hens:${simplifiedEntity}:2026`)).toEqual([
      ["23711", 0n, 5_700_000n],
      ["23711", 6_000_000n, 0n],
      ["23712", 0n, 900_000n],
      ["23712", 900_000n, 0n],
      ["2937", 380_000n, 0n],
      ["7151", 0n, 6_000_000n],
      ["7151", 5_700_000n, 0n],
      ["7152", 0n, 900_000n],
      ["7152", 900_000n, 0n],
      ["7194", 0n, 380_000n],
    ]);
  });

  it("with the PCA off: lists the pullets, not valued (FQ25), and posts nothing for them", async () => {
    expect(await statuses(cgnc, farm(ids.cFarm, "Ferme Rif"), house(ids.cHouse, ids.cFarm, "P1"), place(ids.cPullets, ids.cHouse, "pullet", "2025-09-01", 1000, "900"))).toEqual(Array(3).fill("applied"));
    const preview = await closePreview(cgnc, 2025, clock);
    expect(preview.ok && preview.value.hens).toEqual({ method: null, lines: [expect.objectContaining({ id: ids.cPullets, value: 0n, missing: false })] });
    expect(await runClose(cgnc, { year: 2025 }, clock)).toEqual({ ok: true, value: 0 });
  });
});
