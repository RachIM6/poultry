import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, payPlacement, placementsToPay, postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

// SPEC B1 "Correcting a placement" in the books: FN7 reposts the chicks (a reversal and the new version), and the
// placement debt (§9 "Placement debts") follows the new credit; a payment above it is left as an overpayment.
const clock = fixedClock("2026-11-20T10:00:00Z");
const OK = { ok: true, value: undefined };
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-01T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const place = (id: string, houseId: string, species: string, strainId: string, chicks: number, price: string, vat: string | null = null) =>
  m("flock.placeBatch", { id, houseId, species, strainId, placedOn: "2026-10-01", chicksPlaced: chicks, deadOnArrival: 0, hatchery: "Couvoir Atlas", deliveryNote: "BL", chickUnitPriceCentimes: price, chickVatCentimes: vat, dayOldWeightGrams: null });
const correct = (batchId: string, changes: object) => m("flock.correctPlacement", { batchId, changes });

/** The lines of a source's standing version, sorted: [account, debit, credit]. */
async function standing(sourceId: string) {
  const entries = await db.journalEntry.findMany({ where: { sourceModule: "flock", sourceId }, include: { lines: true } });
  const reversed = new Set((await db.journalEntry.findMany({ where: { reversesId: { in: entries.map((e) => e.id) } } })).map((r) => r.reversesId));
  const live = entries.filter((e) => !reversed.has(e.id));
  expect(live.length).toBeLessThanOrEqual(1);
  return (live[0]?.lines ?? []).map((l) => [l.account, l.debitCentimes, l.creditCentimes]).sort((a, b) => String(a).localeCompare(String(b)));
}
const owedOn = async (ctx: TenantContext, batchId: string) => {
  const list = await placementsToPay(ctx);
  return list.ok ? list.value.find((p) => p.batchId === batchId)?.owed : undefined;
};

describe("a corrected placement in the books (SPEC B1, SPEC-finance FN7, §9 placement debts)", () => {
  let owner: TenantContext;
  const ids = { farm: uuidv7(), h1: uuidv7(), h2: uuidv7(), chicks: uuidv7(), pullets: uuidv7(), hens: uuidv7() };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((a) => ({ chart: a.chart, number: a.number, label: a.label, parentNumber: a.parent, fallback: a.fallback })) });
    await db.strain.createMany({ data: [{ id: "ross-308", name: "Ross 308" }, { id: "isa-brown", name: "ISA Brown", productionTypes: ["pullet", "layer"] }] });
    owner = await tenant("+212600000021", "Ferme Correction");
    // a ledger, VAT-registered: the VAT posts apart (FN9); classic hens (FQ7a)
    expect(await changeAccountingChoices(owner, (await listLegalEntities(owner))[0].id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    const house = (id: string, name: string) => m("farm-registry.createHouse", { id, farmId: ids.farm, name, areaM2: 1000, capacity: 12000, type: "closed" });
    expect(
      await statuses(
        owner,
        m("farm-registry.createFarm", { id: ids.farm, name: "Ferme", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        house(ids.h1, "B1"),
        house(ids.h2, "P1"),
        place(ids.chicks, ids.h1, "broiler", "ross-308", 1000, "550"),
        place(ids.pullets, ids.h2, "pullet", "isa-brown", 1000, "900"),
      ),
    ).toEqual(Array(5).fill("applied"));
    await postPending(owner);
  }, 60_000); // the chart's seed and the first posting: above the 10 s hook default on a loaded Windows Docker

  it("reposts the chicks: the old entry reversed, the new version posted", async () => {
    expect(await standing(ids.chicks)).toEqual([
      ["4411", 0n, 550_000n],
      ["612121", 550_000n, 0n],
    ]);
    expect(await statuses(owner, correct(ids.chicks, { chicksPlaced: 1200, chickUnitPriceCentimes: "600" }))).toEqual(["applied"]);
    await postPending(owner);
    expect(await standing(ids.chicks)).toEqual([
      ["4411", 0n, 720_000n],
      ["612121", 720_000n, 0n],
    ]);
    const versions = await db.journalEntry.findMany({ where: { sourceModule: "flock", sourceId: ids.chicks }, orderBy: { sourceVersion: "asc" } });
    expect(versions).toHaveLength(2); // the first version and the new one
    expect(await db.journalEntry.count({ where: { reversesId: versions[0].id } })).toBe(1); // the first one reversed
    expect(await owedOn(owner, ids.chicks)).toBe(720_000n);
    // a correction that changes nothing finance reads (the hatchery) posts nothing
    expect(await statuses(owner, correct(ids.chicks, { hatchery: "Couvoir du Souss" }))).toEqual(["applied"]);
    expect(await postPending(owner)).toBe(0);
  });

  it("caps payments at the corrected debt, and leaves an overpayment when the debt drops below what was paid", async () => {
    expect(await payPlacement(owner, { id: uuidv7(), batchId: ids.chicks, day: "2026-11-10", amountCentimes: "500000", paidWith: "cash", treasuryId: null }, clock)).toEqual(OK);
    expect(await owedOn(owner, ids.chicks)).toBe(220_000n);
    expect(await statuses(owner, correct(ids.chicks, { chicksPlaced: 800 }))).toEqual(["applied"]); // 800 × 6,00 = 4 800,00, 5 000,00 paid
    await postPending(owner);
    expect(await standing(ids.chicks)).toEqual([
      ["4411", 0n, 480_000n],
      ["612121", 480_000n, 0n],
    ]);
    expect(await owedOn(owner, ids.chicks)).toBeUndefined(); // off the list: nothing owed
    const pay = { id: uuidv7(), batchId: ids.chicks, day: "2026-11-15", amountCentimes: "100", paidWith: "cash", treasuryId: null };
    expect(await payPlacement(owner, pay, clock)).toEqual({ ok: false, error: "NOTHING_OWED" });
    expect(await statuses(owner, correct(ids.chicks, { chicksPlaced: 1000 }))).toEqual(["applied"]); // 6 000,00
    await postPending(owner);
    expect(await owedOn(owner, ids.chicks)).toBe(100_000n);
    expect(await payPlacement(owner, { ...pay, amountCentimes: "100001" }, clock)).toEqual({ ok: false, error: "PAID_MORE_THAN_OWED" });
  });

  it("transfers pullets to laying in their own house, and the classic transfer to lay still posts (FC6)", async () => {
    expect(await statuses(owner, m("flock.transferToLaying", { batchId: ids.pullets, day: "2026-11-01", newBatchId: ids.hens, houseId: ids.h2, hens: 1000 }))).toEqual(["applied"]);
    await postPending(owner);
    const lay = await standing(`lay:${ids.hens}`);
    expect(lay.find(([account]) => account === "23711")).toEqual(["23711", 900_000n, 0n]); // the pullets' cost becomes the hens' value
    expect(await standing(ids.hens)).toEqual([]); // the hens cost nothing at their placement
  });
});
