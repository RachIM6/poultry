import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { cashForecast, changeAccountingChoices, createFixedAsset, payCreditExpense, payFixedAsset, payPlacement, postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

// F-Effects: the debts with no due date (placements, assets on credit, credit expenses) count in the cash schedule,
// on their own day, late ones in the first week (SPEC-finance §9 "Cash schedule: debts without a due date").
const clock = fixedClock("2026-11-20T10:00:00Z");
const OK = { ok: true, value: undefined };
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-09-10T08:00:00+01:00" });

describe("cash schedule: debts without a due date", () => {
  let owner: TenantContext, other: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), box: uuidv7(), power: uuidv7(), water: uuidv7(), paid: uuidv7(), asset: uuidv7() };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [owner, other] = await twoTenants();
    expect(await changeAccountingChoices(owner, (await listLegalEntities(owner))[0].id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true }); // assets post
    const expense = (id: string, day: string, category: string, amountCentimes: string, paidFrom: string) =>
      m("finance.recordExpense", { id, day, category, amountCentimes, paidFrom, treasuryId: paidFrom === "cash" ? ids.box : null, note: null });
    const pushed = await push(
      owner,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("finance.createTreasuryAccount", { id: ids.box, kind: "cash", name: "Caisse" }),
        // 1 000 chicks at 5,50: 5 500,00 owed to the hatchery since 1 October
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, species: "broiler", strainId: "ross-308", placedOn: "2026-10-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null, ageAtPlacementDays: 0 }),
        expense(ids.power, "2026-10-15", "electricity", "120000", "credit"), // 1 200,00, late
        expense(ids.water, "2026-11-18", "water", "30000", "credit"), // 300,00
        expense(ids.paid, "2026-11-02", "vet_fees", "50000", "cash"), // paid at once: no debt
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
    await postPending(owner);
    // 10 000,00 generator bought on credit on 18 September
    const asset = { id: ids.asset, label: "Groupe électrogène", category: "equipment", acquiredOn: "2026-09-18", inServiceOn: "2026-09-18", amountCentimes: "1000000", lifeMonths: 84, paidWith: "credit", treasuryId: null };
    expect(await createFixedAsset(owner, asset, clock)).toEqual(OK);
    // Partly paid from the cash box: 1 500,00 of the chicks, 4 000,00 of the generator, 200,00 of the electricity.
    const paid = { day: "2026-11-05", paidWith: "cash", treasuryId: ids.box };
    expect(await payPlacement(owner, { ...paid, id: uuidv7(), batchId: ids.batch, amountCentimes: "150000" }, clock)).toEqual(OK);
    expect(await payFixedAsset(owner, { ...paid, id: uuidv7(), assetId: ids.asset, amountCentimes: "400000" }, clock)).toEqual(OK);
    expect(await payCreditExpense(owner, { ...paid, id: uuidv7(), expenseId: ids.power, amountCentimes: "20000" }, clock)).toEqual(OK);
  });

  it("puts what is still owed on each in the first week: chicks 4 000,00, generator 6 000,00, expenses 1 000,00 + 300,00", async () => {
    const f = await cashForecast(owner, clock);
    if (!f.ok) throw new Error(f.error);
    expect(f.value.startCentimes).toBe(-620_000n); // 500,00 + 1 500,00 + 4 000,00 + 200,00 out of the cash box
    expect(f.value.weeks.map((w) => [w.from, w.inCentimes, w.outCentimes, w.afterCentimes])).toEqual([
      ["2026-11-20", 0n, 1_130_000n, -1_750_000n],
      ["2026-11-27", 0n, 0n, -1_750_000n],
      ["2026-12-04", 0n, 0n, -1_750_000n],
      ["2026-12-11", 0n, 0n, -1_750_000n],
    ]);
  });

  it("leaves a paid-off debt out", async () => {
    expect(await payCreditExpense(owner, { id: uuidv7(), expenseId: ids.water, day: "2026-11-19", amountCentimes: "30000", paidWith: "cash", treasuryId: ids.box }, clock)).toEqual(OK);
    const f = await cashForecast(owner, clock);
    expect(f.ok && [f.value.startCentimes, f.value.weeks[0].outCentimes]).toEqual([-650_000n, 1_100_000n]);
  });

  it("keeps each organisation to its own debts", async () => {
    const f = await cashForecast(other, clock);
    expect(f.ok && f.value.weeks.every((w) => w.outCentimes === 0n)).toBe(true);
  });
});
