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
import { batchResults, changeAccountingChoices, closeFiscalYear, createFixedAsset, postPending, runClose, saveHensSchedules } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

// SPEC-finance FC6 classic, FQ19 (PCA p. 34), §7.1 G: pullets capitalised on 23962 at their production cost, the
// depreciation of their house and the shared production charges included, across two year ends and at the transfer.
const clock = fixedClock("2027-06-15T10:00:00Z");
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

type Ids = { farm: string; p1: string; l1: string; pullets: string; hens: string; bank: string };
const newIds = (): Ids => ({ farm: uuidv7(), p1: uuidv7(), l1: uuidv7(), pullets: uuidv7(), hens: uuidv7(), bank: uuidv7() });

/**
 * §7.1 G's 2025: 1 000 pullets at 9,00 placed in P1 on 1 October; a catching crew of 200,00 on them (distribution);
 * 1 200,00 of electricity and 300,00 of bank fees (administration) shared over December; the house P1, 120 000,00
 * over 120 months from January 2025.
 */
async function rearing(ctx: TenantContext, ids: Ids) {
  await db.treasuryAccount.create({ data: { id: ids.bank, organizationId: ctx.organizationId, kind: "bank", name: "Banque Populaire" } });
  const house = (id: string, name: string) => m("farm-registry.createHouse", { id, farmId: ids.farm, name, areaM2: 1000, capacity: 12000, type: "closed" });
  expect(
    await statuses(
      ctx,
      m("farm-registry.createFarm", { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      house(ids.p1, "P1"),
      house(ids.l1, "L1"),
      m("flock.placeBatch", { id: ids.pullets, houseId: ids.p1, species: "pullet", strainId: "isa-brown", placedOn: "2025-10-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "900", dayOldWeightGrams: null }),
      expense("2025-12-20", "catching", "20000", { batchId: ids.pullets }),
      expense("2025-12-31", "electricity", "120000", { serviceMonth: "2025-12" }),
      expense("2025-12-31", "bank_fees", "30000", { serviceMonth: "2025-12", treasuryId: ids.bank }),
    ),
  ).toEqual(Array(7).fill("applied"));
  const building = { id: uuidv7(), label: "Poulailler P1", category: "building", houseId: ids.p1, acquiredOn: "2025-01-01", inServiceOn: "2025-01-01", amountCentimes: "12000000", lifeMonths: 120, paidWith: "credit" };
  expect(await createFixedAsset(ctx, building, clock)).toEqual(OK);
}

/** The lines of a source's standing version, sorted: [account, debit, credit]. */
async function standing(module: string, sourceId: string) {
  const entries = await db.journalEntry.findMany({ where: { sourceModule: module, sourceId }, orderBy: { sourceVersion: "desc" }, include: { lines: true } });
  const live = entries.find((e) => !entries.some((x) => x.reversesId === e.id));
  return (live?.lines ?? []).map((l) => [l.account, l.debitCentimes, l.creditCentimes]).sort((a, b) => String(a).localeCompare(String(b)));
}
/** An account's balance (Σ debit − Σ credit) over an entity's entries from a day on (a year closed: its à-nouveaux on). */
const balance = async (legalEntityId: string, account: string, from = "2025-01-01") => {
  const where = { account, entry: { legalEntityId, day: { gte: new Date(`${from}T00:00:00Z`) } } };
  const s = await db.journalLine.aggregate({ where, _sum: { debitCentimes: true, creditCentimes: true } });
  return (s._sum.debitCentimes ?? 0n) - (s._sum.creditCentimes ?? 0n);
};
/** Every journal line of an entity's entries dated on or before a day, as stored. */
const linesUpTo = (legalEntityId: string, day: string) =>
  db.journalLine.findMany({
    where: { entry: { legalEntityId, day: { lte: new Date(`${day}T00:00:00Z`) } } },
    select: { id: true, account: true, debitCentimes: true, creditCentimes: true, treasuryId: true, entry: { select: { id: true, day: true, label: true, sourceId: true, sourceVersion: true, reversesId: true, createdAt: true } } },
    orderBy: { id: "asc" },
  });

describe("pullets capitalised at their production cost (SPEC-finance FC6 classic, FQ19: PCA p. 34)", () => {
  let transfer: TenantContext, long: TenantContext, transferEntity: string, longEntity: string;
  const [t, l] = [newIds(), newIds()];

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "isa-brown", name: "ISA Brown", productionTypes: ["pullet", "layer"] } });
    transfer = await tenant("+212600000021", "Ferme Transfert");
    long = await tenant("+212600000022", "Ferme Longue");
    transferEntity = (await listLegalEntities(transfer))[0].id;
    longEntity = (await listLegalEntities(long))[0].id;
    for (const [ctx, entity] of [[transfer, transferEntity], [long, longEntity]] as const) {
      expect(await changeAccountingChoices(ctx, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true }); // classic (FQ7a)
    }
    await rearing(transfer, t);
    await rearing(long, l);
  }, 60_000); // two organisations and 14 mutations: above the 10 s hook default on a loaded Windows Docker

  it("§7.1 G, 2025: 9 000,00 + 1 200,00 of electricity + 3 024,66 of the house's depreciation on 23962; FN13 keeps every charge and no depreciation", async () => {
    for (const [ctx, entity] of [[transfer, transferEntity], [long, longEntity]] as const) {
      expect(await runClose(ctx, { year: 2025 }, clock)).toMatchObject({ ok: true });
      expect(await standing("finance", `close:hens:${entity}:2025`)).toEqual([
        ["23962", 1_322_466n, 0n], // 900 000 + 120 000 + 1 200 000 × 92 ÷ 365 (302 465,75)
        ["71431", 0n, 1_322_466n],
      ]);
    }
    const results = await batchResults(transfer, "2025-12-31" as FarmDay);
    expect(results.ok && results.value.find((r) => r.id === t.pullets)?.costCentimes).toBe(1_070_000n); // 9 000 + 200 + 1 200 + 300
  });

  it("§7.1 G, 2026 still rearing: the close capitalises 2026 alone, 1 000,00 of vet fees + the house's 12 000,00, nothing of 2025 again", async () => {
    expect(await statuses(long, expense("2026-02-01", "vet_fees", "100000", { batchId: l.pullets }))).toEqual(["applied"]);
    expect(await runClose(long, { year: 2026 }, clock)).toMatchObject({ ok: true });
    expect(await standing("finance", `close:hens:${longEntity}:2026`)).toEqual([
      ["23962", 1_300_000n, 0n],
      ["71431", 0n, 1_300_000n],
    ]);
    expect(await balance(longEntity, "23962")).toBe(1_322_466n + 1_300_000n);
    expect(await runClose(long, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 }); // FN7: same figures
  });

  it("§7.1 G, transfer on 1 March 2026: capitalises the rest (1 000,00 + 60 days of the house), clears 23962 into 23711; 2025 closed stays as posted", async () => {
    expect(await closeFiscalYear(transfer, { year: 2025 }, clock)).toMatchObject({ ok: true });
    const closed = await linesUpTo(transferEntity, "2025-12-31");
    expect(closed.length).toBeGreaterThan(0);

    expect(
      await statuses(
        transfer,
        expense("2026-02-01", "vet_fees", "100000", { batchId: t.pullets }),
        m("flock.transferToLaying", { batchId: t.pullets, day: "2026-03-01", newBatchId: t.hens, houseId: t.l1, hens: 1000 }),
      ),
    ).toEqual(["applied", "applied"]);
    await postPending(transfer);
    expect(await standing("flock", `lay:${t.hens}`)).toEqual([
      ["23711", 1_619_726n, 0n], // 1 322 466 + 297 260
      ["23962", 0n, 1_619_726n],
      ["23962", 297_260n, 0n], // 100 000 + 1 200 000 × 60 ÷ 365 (197 260,27)
      ["71431", 0n, 297_260n],
    ]);
    expect(await balance(transferEntity, "23962", "2026-01-01")).toBe(0n); // the à-nouveaux of 2026 carried 1 322 466

    // The 2026 close: the pullets left on the transfer, so no 23962 line; the flock depreciates from 16 197,26.
    expect(await saveHensSchedules(transfer, { year: 2026, values: { [t.hens]: { life: "14", cull: "4 000" } } })).toEqual({ ok: true, value: 1 });
    expect(await runClose(transfer, { year: 2026 }, clock)).toMatchObject({ ok: true });
    expect(await standing("finance", `close:hens:${transferEntity}:2026`)).toEqual([
      ["28371", 0n, 871_233n], // (1 619 726 − 400 000) × 10 ÷ 14 = 871 232,86
      ["61937", 871_233n, 0n],
    ]);
    expect(await balance(transferEntity, "23962", "2026-01-01")).toBe(0n);

    // The closed year: never re-posted, byte-identical.
    expect(await runClose(transfer, { year: 2025 }, clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await linesUpTo(transferEntity, "2025-12-31")).toEqual(closed);
  });
});
