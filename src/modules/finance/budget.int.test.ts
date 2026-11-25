import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { budgetBases, budgetCash, budgetOf, budgetPaymentDelays, listBudgets, payPlacement, postPending, saveBudget } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant, twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });

describe("budget from a closed batch (SPEC-finance FN15, T35)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), supplier: uuidv7(), feed: uuidv7(), vaccine: uuidv7(), buyer: uuidv7() };

  beforeAll(async () => {
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a, b] = await twoTenants();
    const purchase = (stockItemId: string, quantity: number, price: string) =>
      m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId, day: "2026-09-01", quantity, unitPriceCentimes: price, paidCentimes: "0", dueOn: null });
    const pushed = await push(
      a,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
        purchase(ids.feed, 4_000_000, "460"), // 4 t at 4,60 DH/kg
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: "2026-09-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null }),
        m("flock.recordDay", { batchId: ids.batch, day: "2026-09-02", changes: { dead: 0, culled: 0, feed: { stockItemId: ids.feed, grams: 3_000_000 } } }), // 3 t eaten
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        // all 1 000 birds, 2 000 kg at 14,00 DH/kg = 28 000,00: the batch closes
        m("sales.recordSale", { id: uuidv7(), batchId: ids.batch, buyerId: ids.buyer, day: "2026-10-15", birds: 1000, farmWeightGrams: 2_000_000, buyerWeightGrams: null, pricePerKgCentimes: "1400", paymentMethod: "cash", paidCentimes: "2800000", instrument: null }),
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
    // A T24 other cost recorded before FN13 refused new ones: it still counts.
    await db.batchCost.create({ data: { id: uuidv7(), organizationId: a.organizationId, batchId: ids.batch, day: new Date("2026-09-10T00:00:00Z"), label: "Électricité", amountCentimes: 50_000n } });
  });

  it("turns a closed batch into what-if inputs, with the feed apart", async () => {
    const bases = await budgetBases(a);
    if (!bases.ok) throw new Error(bases.error);
    expect(bases.value.map((x) => x.inputs)).toEqual([
      {
        chicks: 1000n,
        chickPriceCentimes: 550n,
        feedGrams: 3_000_000n,
        feedPricePerKgCentimes: 460n,
        otherCostCentimes: 50_000n, // the electricity of T24's other costs
        plannedGrams: 2_000_000n,
        salePricePerKgCentimes: 1400n,
      },
    ]);
    // The same batch's actual figures: 5 500,00 + 13 800,00 + 500,00 = 19 800,00; break-even 9,90 DH/kg.
    expect(budgetOf(bases.value[0].inputs)).toMatchObject({ plannedCostCentimes: 1_980_000n, breakEvenPerKgCentimes: 990n, plannedMarginCentimes: 820_000n });
  });

  it("gives the weekly cash need the base batch's timing (SPEC-finance §9 \"Budget cash need\")", async () => {
    const bases = await budgetBases(a);
    if (!bases.ok) throw new Error(bases.error);
    const { inputs, timing } = bases.value[0];
    // placed 1 Sep, the feed eaten on day 1, the one sale on day 44 (it closed the batch)
    expect(timing.lastDay).toBe(44);
    expect(timing.feed).toEqual([[1, 1_380_000n]]);
    expect(timing.sales).toEqual([[44, 2_000_000n]]);
    // T24's electricity has no day in the batch: an equal share each of its 45 days
    expect(timing.other.filter(([, w]) => w > 0n)).toEqual(Array.from({ length: 45 }, (_, d) => [d, 50_000n]));
    const cash = budgetCash(inputs, timing);
    expect(cash.weeks).toHaveLength(7);
    expect(cash.weeks[0].outCentimes).toBe(550_000n + 1_380_000n + 7_778n); // chicks, all the feed, 7/45 of 500,00
    expect([cash.peakNeedCentimes, cash.peakWeek]).toEqual([1_980_000n, 7]);
    expect(cash.weeks.at(-1)!.cumulativeCentimes).toBe(820_000n);
  });

  it("saves a budget for the owner and the manager only, each organisation its own", async () => {
    const form = { id: uuidv7(), name: "Bande de janvier", basedOn: ids.batch, chicks: "1200", chickPriceCentimes: "600", feedGrams: "3600000", feedPricePerKgCentimes: "480", otherCostCentimes: "60000", plannedGrams: "2400000", salePricePerKgCentimes: "1450" };
    expect(await saveBudget({ ...a, role: "worker" }, form)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await saveBudget(a, { ...form, chicks: "-3" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveBudget({ ...a, role: "manager" }, form)).toMatchObject({ ok: true });
    const saved = await listBudgets(a);
    expect(saved.ok && saved.value.map((s) => [s.name, s.inputs.feedPricePerKgCentimes])).toEqual([["Bande de janvier", 480n]]);
    const other = await listBudgets(b);
    expect(other.ok && other.value).toEqual([]);
    expect(await budgetBases({ ...a, role: "worker" })).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("keeps the sale day of a budget without a base batch only (SPEC-finance §9 \"Budget cash need\")", async () => {
    const form = { id: uuidv7(), name: "Sans base", basedOn: null, chicks: "1000", chickPriceCentimes: "550", feedGrams: "3000000", feedPricePerKgCentimes: "460", otherCostCentimes: "0", plannedGrams: "2000000", salePricePerKgCentimes: "1400", saleDay: " 41 " };
    expect(await saveBudget(a, { ...form, id: uuidv7(), saleDay: "4 1" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveBudget(a, { ...form, id: uuidv7(), saleDay: "1000" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveBudget(a, form)).toEqual({ ok: true, value: form.id });
    const copied = { ...form, id: uuidv7(), name: "Copié", basedOn: ids.batch }; // its base batch's timing: the day isn't kept
    expect(await saveBudget(a, copied)).toEqual({ ok: true, value: copied.id });
    const saved = await listBudgets(a);
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.value.filter((s) => s.id === form.id || s.id === copied.id).map((s) => [s.name, s.saleDay])).toEqual([["Copié", null], ["Sans base", 41]]);
    const audit = await db.auditEvent.findFirst({ where: { entityId: form.id } });
    expect(audit?.after).toMatchObject({ saleDay: 41 });
  });

  it("saves the same id once (SPEC §7: a double submit, a retry), and copies only a batch of the organisation", async () => {
    const form = { id: uuidv7(), name: "Bande de mars", basedOn: ids.batch, chicks: "1000", chickPriceCentimes: "550", feedGrams: "3000000", feedPricePerKgCentimes: "460", otherCostCentimes: "0", plannedGrams: "2000000", salePricePerKgCentimes: "1400" };
    const twice = await Promise.all([saveBudget(a, form), saveBudget(a, form)]); // at once: one insert wins, the other is a retry
    expect(twice).toEqual([{ ok: true, value: form.id }, { ok: true, value: form.id }]);
    expect(await saveBudget(a, form)).toEqual({ ok: true, value: form.id });
    expect(await db.budget.count({ where: { id: form.id } })).toBe(1);
    expect(await saveBudget(b, form)).toEqual({ ok: false, error: "ALREADY_EXISTS" }); // another organisation's id
    expect(await saveBudget(b, { ...form, id: uuidv7() })).toEqual({ ok: false, error: "INVALID_INPUT" }); // a's batch
    expect(await saveBudget(a, { ...form, id: uuidv7(), basedOn: uuidv7() })).toEqual({ ok: false, error: "INVALID_INPUT" }); // no such batch
  });
});

describe("a budget's supplier payment delays, from the farm's own purchases (SPEC-finance FN15, §9 \"Budget cash need\")", () => {
  let c: TenantContext;
  const ids = { farm: uuidv7(), supplier: uuidv7(), feed: uuidv7(), grower: uuidv7(), vaccine: uuidv7(), box: uuidv7(), late: uuidv7(), soon: uuidv7(), owed: uuidv7(), delivered: uuidv7() };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    c = await tenant("+212600000003", "Ferme C");
    const purchase = (stockItemId: string, day: string, paidCentimes: string, dueOn: string | null, quantity = 1_000_000) =>
      m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId, day, quantity, unitPriceCentimes: "460", paidCentimes, dueOn });
    const houses = [ids.late, ids.soon, ids.owed, ids.delivered].map((id) => ({ batch: id, house: uuidv7() }));
    const place = (i: number, placedOn: string, paidOnDelivery: object | null = null) =>
      m("flock.placeBatch", { id: houses[i].batch, houseId: houses[i].house, strainId: "ross-308", placedOn, chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null, paidOnDelivery });
    const pushed = await push(
      c,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        ...houses.map((h, i) => m("farm-registry.createHouse", { id: h.house, farmId: ids.farm, name: `B${i + 1}`, areaM2: 1000, capacity: 10000, type: "closed" })),
        m("finance.createTreasuryAccount", { id: ids.box, kind: "cash", name: "Caisse" }),
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
        m("inventory.createStockItem", { id: ids.grower, farmId: ids.farm, productId: null, kind: "feed", name: "Croissance", unit: "kg", lot: null, expiresOn: null }),
        m("inventory.createStockItem", { id: ids.vaccine, farmId: ids.farm, productId: null, kind: "vaccine", name: "HB1", unit: "dose", lot: "L1", expiresOn: "2027-01-01" }),
        purchase(ids.feed, "2026-03-01", "0", "2026-03-31"), // on credit, due in 30 days
        purchase(ids.grower, "2026-03-10", "100000", "2026-04-24"), // partly paid, the rest due in 45 days
        purchase(ids.vaccine, "2026-03-12", "0", "2026-06-10", 100), // not feed: left out
        purchase(ids.feed, "2026-03-20", "460000", null),
        purchase(ids.feed, "2026-03-25", "0", null),
        place(0, "2026-03-01"), // paid off in two payments, the last 40 days after
        place(1, "2026-03-05"), // paid off 21 days after
        place(2, "2026-03-06"), // still owed: left out
        place(3, "2026-03-07", { cashAccountId: ids.box, amountCentimes: "550000" }), // paid at delivery: 0
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
    await postPending(c);
    const clock = fixedClock("2026-06-15T10:00:00Z");
    const pay = (batchId: string, day: string, amountCentimes: string) => payPlacement(c, { id: uuidv7(), batchId, day, amountCentimes, paidWith: "cash", treasuryId: null }, clock);
    for (const r of [pay(ids.late, "2026-03-15", "200000"), pay(ids.late, "2026-04-10", "350000"), pay(ids.soon, "2026-03-26", "550000"), pay(ids.owed, "2026-03-20", "549999")]) expect(await r).toEqual({ ok: true, value: undefined });
  });

  it("derives each input's delay as the median of its last purchases", async () => {
    // feed: 30, 45, 0, 0 → 15; chicks: 40, 21, 0 → 21 (the one still owed a centime is left out)
    expect(await budgetPaymentDelays(c)).toEqual({ ok: true, value: { chicks: 21, feed: 15 } });
    expect(await budgetPaymentDelays({ ...c, role: "worker" })).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("is 0 with no history: paid on the day, as before", async () => {
    expect(await budgetPaymentDelays(await tenant("+212600000004", "Ferme D"))).toEqual({ ok: true, value: { chicks: 0, feed: 0 } });
  });

  it("keeps the delays typed with a budget, and none when left to the farm's own", async () => {
    const form = { name: "Avec délais", basedOn: null, chicks: "1000", chickPriceCentimes: "550", feedGrams: "3000000", feedPricePerKgCentimes: "460", otherCostCentimes: "0", plannedGrams: "2000000", salePricePerKgCentimes: "1400", saleDay: "41" };
    const typed = { ...form, id: uuidv7(), chickPaymentDays: "14", feedPaymentDays: " 30 " };
    const own = { ...form, id: uuidv7(), name: "Délais de la ferme" };
    expect(await saveBudget(c, { ...typed, id: uuidv7(), feedPaymentDays: "-1" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveBudget(c, { ...typed, id: uuidv7(), chickPaymentDays: "1000" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveBudget(c, typed)).toEqual({ ok: true, value: typed.id });
    expect(await saveBudget(c, own)).toEqual({ ok: true, value: own.id });
    const saved = await listBudgets(c);
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.value.map((s) => [s.name, s.delays])).toEqual([["Délais de la ferme", { chicks: null, feed: null }], ["Avec délais", { chicks: 14, feed: 30 }]]);
    expect((await db.auditEvent.findFirst({ where: { entityId: typed.id } }))?.after).toMatchObject({ chickPaymentDays: 14, feedPaymentDays: 30 });
    // the typed delays move the cash need: 5 500,00 of chicks in week 3, the feed from week 5 (§9)
    const s = saved.value.find((x) => x.id === typed.id)!;
    const cash = budgetCash(s.inputs, { lastDay: 41, feed: [[0, 1n]], other: [[0, 1n]], sales: [[41, 1n]] }, { chicks: s.delays.chicks!, feed: s.delays.feed! });
    expect(cash.weeks.map((w) => w.outCentimes)).toEqual([0n, 0n, 550_000n, 0n, 1_380_000n, 0n]);
  });
});
