import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, postPending, readBooks } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-10T08:00:00+01:00" });

describe("books (SPEC-finance FN16, T36)", () => {
  let ledger: TenantContext, cashBook: TenantContext;

  // The same M1 events for both: a feed purchase with 3 000,00 paid, chicks, a cash sale, an expense, a cash deposit.
  const record = async (ctx: TenantContext) => {
    const ids = { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), supplier: uuidv7(), feed: uuidv7(), buyer: uuidv7(), box: uuidv7(), bank: uuidv7() };
    const pushed = await push(
      ctx,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
        m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: "2026-03-02", quantity: 2_000_000, unitPriceCentimes: "450", paidCentimes: "300000", dueOn: null }),
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: "2026-03-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null }),
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        m("sales.recordSale", { id: uuidv7(), batchId: ids.batch, buyerId: ids.buyer, day: "2026-03-20", birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "300000", instrument: null }),
        m("finance.createTreasuryAccount", { id: ids.box, kind: "cash", name: "Caisse" }),
        m("finance.createTreasuryAccount", { id: ids.bank, kind: "bank", name: "Banque" }),
        m("finance.recordExpense", { id: uuidv7(), day: "2026-03-21", category: "electricity", amountCentimes: "120000", paidFrom: "cash", treasuryId: ids.box, note: null, batchId: null, serviceMonth: "2026-03" }),
        m("finance.recordTransfer", { id: uuidv7(), day: "2026-03-22", amountCentimes: "100000", fromId: ids.box, toId: ids.bank }),
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
    await postPending(ctx);
  };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [ledger, cashBook] = await twoTenants();
    const [entity] = await listLegalEntities(ledger);
    expect(await changeAccountingChoices(ledger, entity.id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    await record(ledger);
    await record(cashBook);
  });

  it("gives a ledger entity its journals, general ledger and a balanced trial balance", async () => {
    const books = await readBooks(ledger, "2026-03");
    if (!books.ok) throw new Error(books.error);
    expect(books.value.books).toBe("ledger");
    expect(books.value.journals?.map((j) => [j.journal, j.entries.length])).toEqual([["AC", 2], ["BQ", 1], ["CA", 2], ["VT", 1]]);
    expect(books.value.trialBalance).toMatchObject({ balanced: true });
    expect(books.value.trialBalance?.rows.find((r) => r.account === "5161")).toEqual({ account: "5161", debit: 300_000n, credit: 300_000n + 120_000n + 100_000n, balance: -220_000n });
    // 4411: 9 000,00 of feed − 3 000,00 paid at once + 5 500,00 of chicks, all owed
    expect(books.value.trialBalance?.rows.find((r) => r.account === "4411")?.balance).toBe(-(600_000n + 550_000n));
    const bank = books.value.generalLedger?.find((a) => a.account === "5141");
    expect(bank?.lines.map((l) => [l.day, l.journal, l.running])).toEqual([["2026-03-22", "BQ", 100_000n]]);
    expect(books.value.labels["612122"]).toBe("Aliments de bétail");
  });

  it("gives a cash-book entity its receipts and expenses only", async () => {
    const books = await readBooks(cashBook, "2026-03");
    if (!books.ok) throw new Error(books.error);
    expect(books.value.books).toBe("cash_book");
    expect(books.value.journals).toBeUndefined();
    expect(books.value.trialBalance).toBeUndefined();
    expect(books.value.cashBook.rows.map((r) => [r.day, r.account, r.receipt, r.expense])).toEqual([
      ["2026-03-02", "5161", 0n, 300_000n], // the feed paid at once
      ["2026-03-20", "5161", 300_000n, 0n], // the sale
      ["2026-03-21", "5161", 0n, 120_000n], // electricity
      ["2026-03-22", "5161", 0n, 100_000n], // deposited in the bank…
      ["2026-03-22", "5141", 100_000n, 0n], // …and arrived
    ]);
    expect(books.value.cashBook).toMatchObject({ receipts: 400_000n, expenses: 520_000n });
  });

  it("is for owners and managers only", async () => {
    expect(await readBooks({ ...ledger, role: "worker" }, "2026-03")).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await readBooks(ledger, "2026-13")).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});
