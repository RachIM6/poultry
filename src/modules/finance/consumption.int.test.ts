import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { addFarmDays, farmDayOf } from "@/lib/kernel/farm-day";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { batchResults, changeAccountingChoices, postPending, readBooks } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

const m = (type: string, payload: unknown) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-22T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: ReturnType<typeof m>[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const linesOf = async (sourceId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceId } }, include: { entry: true }, orderBy: { debitCentimes: "desc" } })).map((l) => [l.entry.journal, l.account, l.debitCentimes, l.creditCentimes]);

describe("home consumption in the books (SPEC-finance FC7, FQ11, FQ21, FQ25)", () => {
  let owner: TenantContext, other: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), buyer: uuidv7(), sale: uuidv7(), otherFarm: uuidv7(), otherHouse: uuidv7(), otherBatch: uuidv7() };
  const taken = { associate: uuidv7(), employee: uuidv7(), exploitant: uuidv7(), unvalued: uuidv7(), cgnc: uuidv7() };
  const today = farmDayOf(new Date());
  const consume = (id: string, batchId: string, takenBy: string, over: object = {}) =>
    m("sales.recordConsumption", { id, batchId, day: today, takenBy, kind: "live", birds: 10, farmWeightGrams: 20_000, ...over });
  const place = (id: string, houseId: string) =>
    m("flock.placeBatch", { id, houseId, strainId: "ross-308", placedOn: addFarmDays(today, -40), chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    owner = await tenant("+212600000001", "Ferme A"); // an individual exploitant (onboarding's form)
    other = await tenant("+212600000002", "Ferme B");
    expect(await changeAccountingChoices(owner, (await listLegalEntities(owner))[0].id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    expect(await changeAccountingChoices(other, (await listLegalEntities(other))[0].id, { books: "ledger", pcaOverlay: false, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true }); // FN2: CGNC only
    expect(
      await statuses(
        owner,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1200, capacity: 12000, type: "closed" }),
        place(ids.batch, ids.house),
        m("sales.createBuyer", { id: ids.buyer, name: "Abattoir Atlas", phone: null, type: "abattoir" }),
        // 1 000 kg at 15,00 DH/kg = 15 000,00, paid
        m("sales.recordSale", { id: ids.sale, batchId: ids.batch, buyerId: ids.buyer, day: addFarmDays(today, -1), birds: 500, farmWeightGrams: 1_000_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "1500000", instrument: null }),
        consume(taken.associate, ids.batch, "associate"), // 20 kg × 15,00 = 300,00
        consume(taken.employee, ids.batch, "employee", { pricePerKgCentimes: "1400" }), // typed: 20 kg × 14,00 = 280,00
        consume(taken.exploitant, ids.batch, "exploitant"), // 300,00
        consume(taken.unvalued, ids.batch, "associate", { kind: "perHead", lines: [{ item: "hen", birds: 2 }], farmWeightGrams: null }), // never sold by the head: 0
      ),
    ).toEqual(Array(9).fill("applied"));
    expect(
      await statuses(
        other,
        m("farm-registry.createFarm", { id: ids.otherFarm, name: "G", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.otherHouse, farmId: ids.otherFarm, name: "B1", areaM2: 1200, capacity: 12000, type: "closed" }),
        place(ids.otherBatch, ids.otherHouse),
        consume(taken.cgnc, ids.otherBatch, "associate", { pricePerKgCentimes: "1500" }),
      ),
    ).toEqual(Array(4).fill("applied"));
    await postPending(owner);
    await postPending(other); // FQ25 leaves the entry out instead of blocking the pipeline
  });

  it("posts an associate's D 4463 / C 7140 and an employee's D 6171 / C 7140 in OD; a sale as before", async () => {
    expect(await linesOf(taken.associate)).toEqual([["OD", "4463", 30_000n, 0n], ["OD", "7140", 0n, 30_000n]]);
    expect(await linesOf(taken.employee)).toEqual([["OD", "6171", 28_000n, 0n], ["OD", "7140", 0n, 28_000n]]);
    expect((await linesOf(ids.sale)).sort()).toEqual([["VT", "3421", 0n, 1_500_000n], ["VT", "3421", 1_500_000n, 0n], ["VT", "5161", 1_500_000n, 0n], ["VT", "712121", 0n, 1_500_000n]].sort());
  });

  it("posts nothing for the exploitant (FQ11), without a value, or with the PCA off (FQ25), and lists them on /books", async () => {
    for (const id of [taken.exploitant, taken.unvalued, taken.cgnc]) expect(await linesOf(id)).toEqual([]);
    const month = today.slice(0, 7);
    const books = await readBooks(owner, month);
    expect(books.ok && books.value.unposted.map((u) => [u.id, u.takenBy, u.reason, u.birds, u.amountCentimes])).toEqual([
      [taken.exploitant, "exploitant", "FQ11", 10, 30_000n],
      [taken.unvalued, "associate", "noValue", 2, 0n],
    ]);
    const cgnc = await readBooks(other, month);
    expect(cgnc.ok && cgnc.value.unposted.map((u) => [u.id, u.reason])).toEqual([[taken.cgnc, "FQ25"]]);
    expect(await postPending(other)).toBe(0); // and it stays out
  });

  it("counts with the batch's sales and kg sold (FN13)", async () => {
    const rows = await batchResults(owner);
    const row = rows.ok ? rows.value.find((r) => r.id === ids.batch) : undefined;
    // 15 000,00 sold + 300,00 + 280,00 + 300,00 + 0 taken home; 1 000 kg + 3 × 20 kg
    expect(row).toMatchObject({ salesCentimes: 1_588_000n, soldGrams: 1_060_000 });
  });
});
