import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { batchOf, changeAccountingChoices, exportBooks, exportFec, postPending, readBooks, treasuryOverview } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";
import { unzip } from "@/test/unzip";

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

  it("shows each treasury movement's counter-accounts and batch as the cash book does (FN10)", async () => {
    const accountant = { ...cashBook, role: "accountant" as const }; // money.read: the accountant reads them too
    const [overview, books] = await Promise.all([treasuryOverview(accountant, "2026-03"), readBooks(cashBook, "2026-03")]);
    if (!overview.ok) throw new Error(overview.error);
    if (!books.ok) throw new Error(books.error);
    const movements = overview.value.movements;
    const asBooks = (b: (typeof movements)[number]["batch"]) => (b ? `${b.house} · ${b.placedOn.split("-").reverse().join("/")}` : "");
    const treasury = movements.map((x) => JSON.stringify([x.day, x.account, x.counterAccounts.map((c) => c.number), asBooks(x.batch)]));
    const cash = books.value.cashBook.rows.map((r) => JSON.stringify([r.day, r.account, [...new Set(r.counterAccounts)], batchOf(books.value.tags, r.entryId)]));
    expect(treasury.sort()).toEqual(cash.sort());
    // The sale: the buyer's account with its label, and its batch; the transfer's two legs go through 5115 only.
    const sale = movements.find((x) => x.day === "2026-03-20");
    expect(sale?.counterAccounts).toContainEqual({ number: "3421", label: "Clients" });
    expect(sale?.batch).toEqual({ house: "B1", placedOn: "2026-03-01" }); // the screen formats the day
    expect(movements.filter((x) => x.day === "2026-03-22").map((x) => [x.account, x.counterAccounts, x.batch]).sort()).toEqual([["5141", [], null], ["5161", [], null]]);
    expect(movements.flatMap((x) => x.counterAccounts).every((c) => c.label !== "")).toBe(true);
  });

  it("exports a month for the accountant: CSV and Excel in one zip (FN18, T38)", async () => {
    const exported = await exportBooks(ledger, "2026-03");
    if (!exported.ok) throw new Error(exported.error);
    expect(exported.value.file).toBe("comptabilite-2026-03.zip");
    const files = unzip(exported.value.zip);
    expect([...files.keys()]).toEqual(["ecritures-2026-03.csv", "balance-2026-03.csv", "recettes-depenses-2026-03.csv", "livres-2026-03.xlsx"]);
    // The electricity expense, both lines, with the chart's labels.
    expect(files.get("ecritures-2026-03.csv")).toMatch(/\r\n21\/03\/2026;CA;[0-9a-f-]{36};5161;Caisses;[^;]+;0,00;1200,00;;;;\r\n/);
    expect(files.get("balance-2026-03.csv")).toMatch(/\r\nTotal;;(\d+,\d\d);\1;0,00\r\n$/);
    // FN18's analytic columns, from each entry's source: the supplier and farm, the chicks' batch, the buyer and batch.
    const entries = files.get("ecritures-2026-03.csv")!;
    expect(entries).toMatch(/;612122;[^;]+;Achat;9000,00;0,00;Alf;F;;\r\n/);
    expect(entries).toMatch(/;612121;[^;]+;Achat de poussins;5500,00;0,00;;F;B1;01\/03\/2026\r\n/);
    expect(entries).toMatch(/;3421;[^;]+;Vente;3000,00;0,00;Hamid;F;B1;01\/03\/2026\r\n/);

    const cash = await exportBooks(cashBook, "2026-03");
    if (!cash.ok) throw new Error(cash.error);
    expect([...unzip(cash.value.zip).keys()]).toEqual(["recettes-depenses-2026-03.csv", "livres-2026-03.xlsx"]);
    // FN16: a cash-book entity's receipts and expenses with their batch (the sale's), none for the electricity bill
    const cashCsv = unzip(cash.value.zip).get("recettes-depenses-2026-03.csv")!;
    expect(cashCsv).toMatch(/\r\n20\/03\/2026;Vente;5161;[^;]+;3421 [^;]+;B1 · 01\/03\/2026;3000,00;0,00\r\n/);
    expect(cashCsv).toMatch(/\r\n21\/03\/2026;Dépense;5161;[^;]+;[^;]+;;0,00;1200,00\r\n/);
    expect(await exportBooks({ ...ledger, role: "worker" }, "2026-03")).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("exports a month as a FEC for the accountant's software (FC10, T118)", async () => {
    const fec = await exportFec(ledger, "2026-03");
    if (!fec.ok) throw new Error(fec.error);
    expect(fec.value.file).toBe("FEC20260331.txt");
    const rows = fec.value.data.toString("utf8").split("\r\n").slice(0, -1).map((r) => r.split("\t"));
    expect(rows[0].slice(0, 3)).toEqual(["JournalCode", "JournalLib", "EcritureNum"]);
    // all six entries, numbered 1…6 in the order they were posted, each balanced
    const nums = [...new Set(rows.slice(1).map((r) => r[2]))];
    expect(nums).toEqual(["1", "2", "3", "4", "5", "6"]);
    const cents = (s: string) => BigInt(s.replace(",", ""));
    for (const n of nums) expect(rows.filter((r) => r[2] === n).reduce((s, r) => s + cents(r[11]) - cents(r[12]), 0n)).toBe(0n);
    // the electricity expense's cash line, and the feed purchase with FN18's supplier and farm after the 18 fields
    expect(rows).toContainEqual(["CA", "Caisse", expect.any(String), "20260321", "5161", "Caisses", "", "", expect.stringMatching(/^[0-9a-f-]{36}$/), "20260321", expect.any(String), "0,00", "1200,00", "", "", expect.stringMatching(/^\d{8}$/), "", "", "", "", "", ""]);
    expect(rows).toContainEqual(expect.arrayContaining(["612122", "Achat", "9000,00", "0,00", "Alf", "F"]));

    expect(await exportFec(cashBook, "2026-03")).toEqual({ ok: false, error: "NOT_FOUND" }); // no journals in a cash book
    expect(await exportFec({ ...ledger, role: "worker" }, "2026-03")).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("is for owners and managers only", async () => {
    expect(await readBooks({ ...ledger, role: "worker" }, "2026-03")).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await readBooks(ledger, "2026-13")).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});
