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
import { batchResults, budgetBases, changeAccountingChoices, postPending, saveHensSchedules } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

// SPEC-finance FN13, §9 "Laying hens in the batch result", §7.1 H: a laying flock carries its hens' entry value used up
// to the day, not their price; a pullet batch transferred to lay hands its cost to the layer batch. Meat batches as before.
const clock = fixedClock("2026-11-25T10:00:00Z");
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const place = (id: string, houseId: string, species: string, placedOn: string, chicks: number, price: string, age = 0) =>
  m("flock.placeBatch", { id, houseId, species, strainId: species === "broiler" ? "ross-308" : "isa-brown", placedOn, chicksPlaced: chicks, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: price, dayOldWeightGrams: null, ageAtPlacementDays: age });
const dead = (batchId: string, day: string, birds: number) => m("flock.recordDay", { batchId, day, changes: { dead: birds, culled: 0 } });

/** A farm with houses L1 (laying), P1 (rearing), B1 (broilers), and 5 000 point-of-lay hens at 55,00 in L1 on 4 November (§7.1 H). */
async function farm(ctx: TenantContext, ids: Record<string, string>) {
  expect(
    await statuses(
      ctx,
      m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      ...["laying", "rearing", "broilers"].map((h, i) => m("farm-registry.createHouse", { id: ids[h], farmId: ids.farm, name: ["L1", "P1", "B1"][i], areaM2: 1000, capacity: 12000, type: "closed" })),
      place(ids.hens, ids.laying, "layer", "2026-11-04", 5000, "5500", 154),
      dead(ids.hens, "2026-11-20", 25),
    ),
  ).toEqual(Array(6).fill("applied"));
}

const ids = () => ({ farm: uuidv7(), laying: uuidv7(), rearing: uuidv7(), broilers: uuidv7(), hens: uuidv7(), pullets: uuidv7(), layers: uuidv7(), chicks: uuidv7() });
const row = async (ctx: TenantContext, id: string) => {
  const r = await batchResults(ctx, undefined, clock);
  if (!r.ok) throw new Error(r.error);
  return r.value.find((x) => x.id === id)!;
};

describe("laying hens in the batch result (SPEC-finance FN13, §9, §7.1 H)", () => {
  let cashBook: TenantContext, classic: TenantContext, simplified: TenantContext;
  const c = ids(), k = ids(), s = ids();

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.createMany({ data: [{ id: "ross-308", name: "Ross 308" }, { id: "isa-brown", name: "ISA Brown", productionTypes: ["pullet", "layer"] }] });
    cashBook = await tenant("+212600000021", "Ferme Carnet");
    classic = await tenant("+212600000022", "Ferme Classique");
    simplified = await tenant("+212600000023", "Ferme Simple");
    expect(await changeAccountingChoices(classic, (await listLegalEntities(classic))[0].id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    expect(await changeAccountingChoices(simplified, (await listLegalEntities(simplified))[0].id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1, hensMethod: "simplified" })).toMatchObject({ ok: true });
    await farm(cashBook, c);
    await farm(classic, k);
    await farm(simplified, s);
  });

  it("bought hens, no schedule: the entry value of the 25 dead (1 375,00), never the 275 000,00 paid", async () => {
    for (const [ctx, id, basis] of [[cashBook, c.hens, "birdsGone"], [simplified, s.hens, "birdsGone"], [classic, k.hens, "pending"]] as const) {
      const r = await row(ctx, id);
      expect(r.costs).toMatchObject({ chicks: 0n, hens: 137_500n, transferred: 0n });
      expect(r.hens).toEqual({ basis, entry: 27_500_000n, depreciation: 0n, removed: 137_500n });
      expect(r.costCentimes).toBe(137_500n);
    }
  });

  it("classic, with the owner's laying period and cull value: the depreciation to date, (275 000 − 100 000) × 1 ÷ 14", async () => {
    await postPending(classic); // the purchase on 23711, so the schedule can be typed (FC6)
    expect(await saveHensSchedules(classic, { year: 2026, values: { [k.hens]: { life: "14", cull: "100 000" } } })).toEqual({ ok: true, value: 1 });
    const r = await row(classic, k.hens);
    expect(r.hens).toEqual({ basis: "depreciation", entry: 27_500_000n, depreciation: 1_250_000n, removed: 0n });
    expect(r.costCentimes).toBe(1_250_000n);
    const asOf = await batchResults(classic, "2026-12-31" as FarmDay, clock); // as on a later day: December counts too
    expect(asOf.ok && asOf.value.find((x) => x.id === k.hens)?.costs.hens).toBe(2_500_000n);
  });

  it("pullets reared and transferred: the pullet batch hands its whole cost to the layer batch, which depreciates it", async () => {
    // 1 000 pullets at 9,00 on 1 June, 1 000,00 of vet fees, transferred on 1 October
    expect(
      await statuses(
        classic,
        place(k.pullets, k.rearing, "pullet", "2026-06-01", 1000, "900"),
        m("finance.recordExpense", { id: uuidv7(), day: "2026-07-01", category: "vet_fees", amountCentimes: "100000", paidFrom: "credit", treasuryId: null, note: null, batchId: k.pullets, serviceMonth: null }),
        m("flock.transferToLaying", { batchId: k.pullets, day: "2026-10-01", newBatchId: k.layers, houseId: k.rearing, hens: 1000 }),
      ),
    ).toEqual(Array(3).fill("applied"));
    const pullets = await row(classic, k.pullets);
    expect(pullets.costs).toMatchObject({ chicks: 900_000n, direct: 100_000n, transferred: -1_000_000n });
    expect(pullets.costCentimes).toBe(0n);
    expect((await row(classic, k.layers)).hens).toEqual({ basis: "pending", entry: 1_000_000n, depreciation: 0n, removed: 0n }); // none gone yet
    await postPending(classic);
    // the books still take the pullets' whole production cost (#278): FN13 handing it on moves no posting
    const lay = await db.journalEntry.findFirstOrThrow({ where: { sourceModule: "flock", sourceId: `lay:${k.layers}` }, include: { lines: true } });
    expect(lay.lines.find((l) => l.account === "23711")?.debitCentimes).toBe(1_000_000n);
    expect(await saveHensSchedules(classic, { year: 2026, values: { [k.layers]: { life: "10", cull: "0" } } })).toEqual({ ok: true, value: 1 });
    const layers = await row(classic, k.layers);
    expect(layers.hens).toEqual({ basis: "depreciation", entry: 1_000_000n, depreciation: 200_000n, removed: 0n }); // October, November: 10 000 × 2 ÷ 10
    expect(layers.costs).toMatchObject({ chicks: 0n, hens: 200_000n });
    // a budget copied from the closed pullet batch keeps its whole cost: 9 000 chicks, 1 000 in other costs
    const bases = await budgetBases(classic);
    expect(bases.ok && bases.value.find((b) => b.batchId === k.pullets)?.inputs.otherCostCentimes).toBe(100_000n);
  });

  it("a closed flock has used up its whole entry value, with or without a schedule", async () => {
    const buyer = uuidv7();
    expect(
      await statuses(
        cashBook,
        m("sales.createBuyer", { id: buyer, name: "Hamid", phone: null, type: "trader" }),
        m("sales.recordSale", { id: uuidv7(), batchId: c.hens, buyerId: buyer, day: "2026-11-24", birds: 4975, farmWeightGrams: 9_950_000, buyerWeightGrams: null, pricePerKgCentimes: "1000", paymentMethod: "cash", paidCentimes: "9950000", instrument: null }),
      ),
    ).toEqual(["applied", "applied"]);
    const r = await row(cashBook, c.hens);
    expect(r.closedOn).toBe("2026-11-24");
    expect(r.costs.hens).toBe(27_500_000n);
  });

  it("meat batches are unchanged: their chicks' price, no hens line", async () => {
    expect(await statuses(cashBook, place(c.chicks, c.broilers, "broiler", "2026-11-10", 1000, "550"))).toEqual(["applied"]);
    const r = await row(cashBook, c.chicks);
    expect(r.costs).toMatchObject({ chicks: 550_000n, hens: 0n, transferred: 0n });
    expect(r.hens).toBeNull();
    expect(r.costCentimes).toBe(550_000n);
  });
});
