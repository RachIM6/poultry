import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import {
  assetRegister,
  attachFixedAssetReceipt,
  changeAccountingChoices,
  createFixedAsset,
  disposeFixedAsset,
  payFixedAsset,
  readBooks,
  setPeriodLocked,
  treasuryOverview,
  updateFixedAsset,
} from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant, twoTenants } from "@/test/tenant";

const clock = fixedClock("2028-06-15T10:00:00Z");
// SPEC-finance §7.1 A: the generator, 47 350,00, in service on 18 Sep 2026, 84 months typed by the owner.
const generator = (more: object = {}) => ({
  id: uuidv7(),
  label: "Groupe électrogène",
  category: "equipment",
  acquiredOn: "2026-09-18",
  inServiceOn: "2026-09-18",
  amountCentimes: "4735000",
  lifeMonths: 84,
  paidWith: "cash",
  ...more,
});
const linesOf = async (sourceId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceModule: "finance", sourceId } }, include: { entry: true }, orderBy: [{ entry: { sourceVersion: "asc" } }, { debitCentimes: "desc" }] })).map((l) => [
    l.entry.sourceVersion,
    l.entry.journal,
    l.entry.day.toISOString().slice(0, 10),
    l.account,
    l.debitCentimes,
    l.creditCentimes,
    l.treasuryId,
  ]);
const entriesOf = (id: string) => db.journalEntry.count({ where: { sourceModule: "finance", sourceId: { startsWith: `asset:${id}:` } } });

describe("fixed assets (SPEC-finance FC1, T102)", () => {
  let owner: TenantContext, cashBook: TenantContext, other: TenantContext;
  const [box, bank, otherBank] = [uuidv7(), uuidv7(), uuidv7()];
  const [farm, house, otherHouse] = [uuidv7(), uuidv7(), uuidv7()];

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [owner, cashBook] = await twoTenants();
    other = await tenant("+212600000003", "Ferme C");
    expect(await changeAccountingChoices(owner, (await listLegalEntities(owner))[0].id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    // Another organisation, VAT-registered and without the PCA (FN2: the CGNC accounts).
    expect(await changeAccountingChoices(other, (await listLegalEntities(other))[0].id, { books: "ledger", pcaOverlay: false, fiscalYearStartMonth: 1, vatRegistered: true })).toMatchObject({ ok: true });
    await db.treasuryAccount.createMany({
      data: [
        { id: box, organizationId: owner.organizationId, kind: "cash", name: "Caisse ferme" },
        { id: bank, organizationId: owner.organizationId, kind: "bank", name: "Banque Populaire" },
        { id: otherBank, organizationId: other.organizationId, kind: "bank", name: "CIH" },
      ],
    });
    const place = { region: "Casablanca-Settat", province: "Berrechid", commune: "Had Soualem" };
    await db.farm.create({ data: { id: farm, organizationId: owner.organizationId, name: "Ferme Sud", ...place } });
    await db.house.create({ data: { id: house, organizationId: owner.organizationId, farmId: farm, name: "Bâtiment 1", areaM2: 1000, capacity: 10000, type: "closed" } });
    const otherFarm = uuidv7();
    await db.farm.create({ data: { id: otherFarm, organizationId: other.organizationId, name: "Ferme C", ...place } });
    await db.house.create({ data: { id: otherHouse, organizationId: other.organizationId, farmId: otherFarm, name: "B1", areaM2: 1000, capacity: 10000, type: "open" } });
  });

  it("posts each acquisition method's FC1 entry once, on its day; an asset in the opening balance posts nothing", async () => {
    const methods = [["cash", box, "CA", "5161"], ["transfer", bank, "BQ", "5141"], ["cheque", bank, "BQ", "5141"], ["credit", null, "OD", "4481"]] as const;
    for (const [paidWith, treasuryId, journal, account] of methods) {
      const a = generator({ paidWith, treasuryId, houseId: house });
      expect(await createFixedAsset(owner, a, clock), paidWith).toEqual({ ok: true, value: undefined });
      expect(await createFixedAsset(owner, a, clock), paidWith).toEqual({ ok: true, value: undefined }); // the same form again
      expect(await linesOf(`asset:${a.id}:acq`), paidWith).toEqual([
        [1, journal, "2026-09-18", "2332", 4_735_000n, 0n, null],
        [1, journal, "2026-09-18", account, 0n, 4_735_000n, treasuryId],
      ]);
      expect(await db.fixedAsset.findUnique({ where: { id: a.id } })).toMatchObject({ farmId: farm, houseId: house, costCentimes: 4_735_000n, paidWith });
      expect(await db.auditEvent.count({ where: { entity: "FixedAsset", entityId: a.id, action: "create" } })).toBe(1);
    }

    // Bought before Dawra: its cost and accumulated depreciation are in the opening entry (FCX3), typed by hand.
    const truck = { ...generator({ label: "Camion", category: "transport", acquiredOn: "2024-01-10", inServiceOn: "2024-01-10", amountCentimes: "1200000", lifeMonths: 60 }), paidWith: null, opening: { on: "2026-01-01", accumulatedCentimes: "480000" } };
    expect(await createFixedAsset(owner, truck, clock)).toEqual({ ok: true, value: undefined });
    expect(await entriesOf(truck.id)).toBe(0);
    const register = await assetRegister(owner, clock);
    if (!register.ok) throw new Error(register.error);
    expect(register.value.assets.find((x) => x.id === truck.id)?.schedule.map((y) => [y.from.slice(0, 4), y.charge, y.accumulated])).toEqual([
      ["2026", 240_000n, 720_000n],
      ["2027", 240_000n, 960_000n],
      ["2028", 240_000n, 1_200_000n],
    ]);
    expect(await createFixedAsset(owner, { ...truck, id: uuidv7(), paidWith: "cash" }, clock)).toEqual({ ok: false, error: "INVALID_INPUT" }); // paid, or opening: not both
    expect(await createFixedAsset(owner, { ...truck, id: uuidv7(), opening: null }, clock)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("keeps a VAT-registered entity's VAT on 3455 and lands PCA accounts on their CGNC account with the PCA off", async () => {
    const a = generator({ category: "installation", amountCentimes: "5682000", vatCentimes: "947000", paidWith: "transfer", treasuryId: otherBank });
    expect(await createFixedAsset(other, a, clock)).toEqual({ ok: true, value: undefined });
    expect(await linesOf(`asset:${a.id}:acq`)).toEqual([
      [1, "BQ", "2026-09-18", "2331", 4_735_000n, 0n, null], // 233111 → 2331 without the PCA
      [1, "BQ", "2026-09-18", "3455", 947_000n, 0n, null],
      [1, "BQ", "2026-09-18", "5141", 0n, 5_682_000n, otherBank],
    ]);
    expect(await db.fixedAsset.findUnique({ where: { id: a.id } })).toMatchObject({ amountCentimes: 5_682_000n, vatCentimes: 947_000n, costCentimes: 4_735_000n });
  });

  it("requires a life above zero, never prefilled; land has none and no schedule", async () => {
    for (const lifeMonths of [null, 0]) expect(await createFixedAsset(owner, generator({ lifeMonths }), clock)).toEqual({ ok: false, error: "LIFE_REQUIRED" });
    expect(await createFixedAsset(owner, generator({ lifeMonths: undefined }), clock)).toEqual({ ok: false, error: "INVALID_INPUT" }); // not even sent
    expect(await createFixedAsset(owner, generator({ category: "land", lifeMonths: 240 }), clock)).toEqual({ ok: false, error: "LAND_NOT_DEPRECIATED" });
    const land = generator({ label: "Terrain", category: "land", lifeMonths: null, amountCentimes: "30000000" });
    expect(await createFixedAsset(owner, land, clock)).toEqual({ ok: true, value: undefined });
    expect((await linesOf(`asset:${land.id}:acq`)).map((l) => [l[3], l[4], l[5]])).toEqual([["23111", 30_000_000n, 0n], ["5161", 0n, 30_000_000n]]);
    const register = await assetRegister(owner, clock);
    if (!register.ok) throw new Error(register.error);
    expect(register.value.assets.find((x) => x.id === land.id)).toMatchObject({ lifeMonths: null, schedule: [], accumulated: 0n });
  });

  it("disposes of §7.1 A's generator on 15 Mar 2028: the 2028 depreciation, the exit at cost and the price on 7513", async () => {
    const a = generator();
    expect(await createFixedAsset(owner, a, clock)).toEqual({ ok: true, value: undefined });
    const sale = { assetId: a.id, day: "2028-03-15", priceCentimes: "3000000", receivedIn: "bank", treasuryId: bank };
    expect(await disposeFixedAsset(owner, { ...sale, treasuryId: box }, clock)).toEqual({ ok: false, error: "INVALID_INPUT" }); // a cash box isn't a bank
    expect(await disposeFixedAsset(owner, sale, clock)).toEqual({ ok: true, value: undefined });
    expect(await disposeFixedAsset(owner, sale, clock)).toEqual({ ok: true, value: undefined }); // the same form again
    expect(await linesOf(`asset:${a.id}:disposal`)).toEqual([
      [1, "OD", "2028-03-15", "6193", 112_738n, 0n, null], // cumulative(18) − cumulative(16) = 1 014 643 − 901 905
      [1, "OD", "2028-03-15", "2833", 0n, 112_738n, null],
      [2, "OD", "2028-03-15", "6513", 3_720_357n, 0n, null], // 37 203,57
      [2, "OD", "2028-03-15", "2833", 1_014_643n, 0n, null], // 10 146,43
      [2, "OD", "2028-03-15", "2332", 0n, 4_735_000n, null],
      [3, "OD", "2028-03-15", "5141", 3_000_000n, 0n, bank],
      [3, "OD", "2028-03-15", "7513", 0n, 3_000_000n, null],
    ]);
    expect(await disposeFixedAsset(owner, { ...sale, priceCentimes: "0" }, clock)).toEqual({ ok: false, error: "ALREADY_DISPOSED" });
    expect(await db.fixedAsset.findUnique({ where: { id: a.id } })).toMatchObject({ disposedOn: new Date("2028-03-15T00:00:00Z"), disposalPriceCentimes: 3_000_000n });
    const register = await assetRegister({ ...owner, role: "accountant" }, clock);
    if (!register.ok) throw new Error(register.error);
    const view = register.value.assets.find((x) => x.id === a.id)!;
    expect(view.schedule.map((y) => [y.from.slice(0, 4), y.charge, y.toDisposal])).toEqual([["2026", 225_476n, false], ["2027", 676_429n, false], ["2028", 112_738n, true]]);
    expect(view.accumulated).toBe(1_014_643n);
    expect(await updateFixedAsset(owner, { assetId: a.id, lifeMonths: 96, residualCentimes: "0" })).toEqual({ ok: false, error: "ALREADY_DISPOSED" });

    const scrapped = generator({ label: "Ventilateur", inServiceOn: "2027-01-05", acquiredOn: "2027-01-05" });
    expect(await createFixedAsset(owner, scrapped, clock)).toEqual({ ok: true, value: undefined });
    expect(await disposeFixedAsset(owner, { assetId: scrapped.id, day: "2026-12-31", priceCentimes: "0", receivedIn: "cash", treasuryId: null }, clock)).toEqual({ ok: false, error: "DISPOSAL_BEFORE_IN_SERVICE" });
    expect(await disposeFixedAsset(owner, { assetId: scrapped.id, day: "2028-06-15", priceCentimes: "0", receivedIn: "cash", treasuryId: null }, clock)).toEqual({ ok: true, value: undefined });
    expect((await linesOf(`asset:${scrapped.id}:disposal`)).map((l) => l[0])).toEqual([1, 1, 2, 2, 2]); // no price, no entry for it
  });

  it("pays an asset bought on credit later, D 4481 / C the cash box or the bank, up to what is owed", async () => {
    const a = generator({ paidWith: "credit", amountCentimes: "1000000" });
    expect(await createFixedAsset(owner, a, clock)).toEqual({ ok: true, value: undefined });
    const payment = { id: uuidv7(), assetId: a.id, day: "2026-10-05", amountCentimes: "400000", paidWith: "cash", treasuryId: box };
    expect(await payFixedAsset(owner, payment, clock)).toEqual({ ok: true, value: undefined });
    expect(await payFixedAsset(owner, payment, clock)).toEqual({ ok: true, value: undefined }); // the same form again
    expect(await linesOf(`asset:${a.id}:pay:${payment.id}`)).toEqual([[1, "CA", "2026-10-05", "4481", 400_000n, 0n, null], [1, "CA", "2026-10-05", "5161", 0n, 400_000n, box]]);
    expect(await payFixedAsset(owner, { ...payment, id: uuidv7(), amountCentimes: "600001" }, clock)).toEqual({ ok: false, error: "PAID_MORE_THAN_OWED" });
    expect(await payFixedAsset(owner, { ...payment, id: uuidv7(), amountCentimes: "600000", paidWith: "cheque", treasuryId: bank }, clock)).toEqual({ ok: true, value: undefined });
    const register = await assetRegister(owner, clock);
    if (!register.ok) throw new Error(register.error);
    expect(register.value.assets.find((x) => x.id === a.id)?.owed).toBe(0n);
    const paidCash = generator();
    expect(await createFixedAsset(owner, paidCash, clock)).toEqual({ ok: true, value: undefined });
    expect(await payFixedAsset(owner, { ...payment, id: uuidv7(), assetId: paidCash.id }, clock)).toEqual({ ok: false, error: "INVALID_INPUT" }); // nothing owed
  });

  it("changes the life and the residual value only, checked as at registration", async () => {
    const a = generator();
    expect(await createFixedAsset(owner, a, clock)).toEqual({ ok: true, value: undefined });
    expect(await updateFixedAsset(owner, { assetId: a.id, lifeMonths: 0, residualCentimes: "0" })).toEqual({ ok: false, error: "LIFE_REQUIRED" });
    expect(await updateFixedAsset(owner, { assetId: a.id, lifeMonths: 60, residualCentimes: "4735001" })).toEqual({ ok: false, error: "RESIDUAL_ABOVE_COST" });
    expect(await updateFixedAsset(owner, { assetId: a.id, lifeMonths: 60, residualCentimes: "35000" })).toEqual({ ok: true, value: undefined });
    expect(await db.fixedAsset.findUnique({ where: { id: a.id } })).toMatchObject({ lifeMonths: 60, residualCentimes: 35_000n, costCentimes: 4_735_000n });
    expect(await db.auditEvent.findFirst({ where: { entity: "FixedAsset", entityId: a.id, action: "update" } })).toMatchObject({
      before: { lifeMonths: 84, residualCentimes: "0" },
      after: { lifeMonths: 60, residualCentimes: "35000" },
    });
  });

  it("refuses an entry in a locked month with the reason, and writes nothing", async () => {
    const entity = (await listLegalEntities(owner))[0].id;
    expect(await setPeriodLocked(owner, entity, "2027-02", true)).toEqual({ ok: true, value: undefined });
    const a = generator({ acquiredOn: "2027-02-10", inServiceOn: "2027-02-10" });
    expect(await createFixedAsset(owner, a, clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await db.fixedAsset.count({ where: { id: a.id } })).toBe(0);
    const b = generator();
    expect(await createFixedAsset(owner, b, clock)).toEqual({ ok: true, value: undefined });
    expect(await disposeFixedAsset(owner, { assetId: b.id, day: "2027-02-20", priceCentimes: "100000", receivedIn: "cash", treasuryId: box }, clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await db.journalEntry.count({ where: { sourceId: `asset:${b.id}:disposal` } })).toBe(0); // not in March either
    expect(await db.fixedAsset.findUnique({ where: { id: b.id } })).toMatchObject({ disposedOn: null });
    expect(await setPeriodLocked(owner, entity, "2027-02", false)).toEqual({ ok: true, value: undefined });
  });

  it("shows its entries in the books and the treasury, though their source key isn't an expense's id", async () => {
    const books = await readBooks(owner, "2026-09");
    if (!books.ok) throw new Error(books.error);
    expect(books.value.journals?.find((j) => j.journal === "CA")?.entries.some((e) => e.label === "Acquisition : Groupe électrogène")).toBe(true);
    const treasury = await treasuryOverview(owner, "2026-09");
    if (!treasury.ok) throw new Error(treasury.error);
    expect(treasury.value.movements.find((m) => m.label === "Acquisition : Groupe électrogène" && m.treasuryId === box)).toMatchObject({ creditCentimes: 4_735_000n, receipt: undefined });
  });

  it("keeps a cash_book entity's register and schedules only: nothing posted, no debt to pay (FCX4, FQ27)", async () => {
    const a = generator({ paidWith: "credit" });
    expect(await createFixedAsset(cashBook, a, clock)).toEqual({ ok: true, value: undefined });
    expect(await updateFixedAsset(cashBook, { assetId: a.id, lifeMonths: 84, residualCentimes: "0" })).toEqual({ ok: true, value: undefined });
    expect(await payFixedAsset(cashBook, { id: uuidv7(), assetId: a.id, day: "2026-10-05", amountCentimes: "100000", paidWith: "cash", treasuryId: null }, clock)).toEqual({ ok: false, error: "CASH_BOOK_NO_PAYMENT" });
    expect(await disposeFixedAsset(cashBook, { assetId: a.id, day: "2028-03-15", priceCentimes: "3000000", receivedIn: "cash", treasuryId: null }, clock)).toEqual({ ok: true, value: undefined });
    expect(await entriesOf(a.id)).toBe(0);
    expect(await db.journalEntry.count({ where: { organizationId: cashBook.organizationId } })).toBe(0);
    expect(await db.fixedAsset.findUnique({ where: { id: a.id } })).toMatchObject({ disposedOn: new Date("2028-03-15T00:00:00Z"), disposalPriceCentimes: 3_000_000n });

    // The same schedule as a ledger entity's, for the same asset.
    const ledger = generator();
    expect(await createFixedAsset(owner, ledger, clock)).toEqual({ ok: true, value: undefined });
    expect(await disposeFixedAsset(owner, { assetId: ledger.id, day: "2028-03-15", priceCentimes: "3000000", receivedIn: "cash", treasuryId: null }, clock)).toEqual({ ok: true, value: undefined });
    const [mine, theirs] = await Promise.all([assetRegister(cashBook, clock), assetRegister(owner, clock)]);
    if (!mine.ok || !theirs.ok) throw new Error("register");
    expect(mine.value.books).toBe("cash_book");
    const schedule = mine.value.assets.find((x) => x.id === a.id)!.schedule;
    expect(schedule.map((y) => y.charge)).toEqual([225_476n, 676_429n, 112_738n]);
    expect(schedule).toEqual(theirs.value.assets.find((x) => x.id === ledger.id)!.schedule);
  });

  it("is the owner's to write; the manager and the accountant read; workers and other organisations get nothing", async () => {
    const a = generator({ houseId: house });
    for (const role of ["manager", "accountant", "worker"] as const) {
      const ctx = { ...owner, role };
      expect(await createFixedAsset(ctx, a, clock), role).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await updateFixedAsset(ctx, { assetId: a.id, lifeMonths: 60, residualCentimes: "0" }), role).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await payFixedAsset(ctx, { id: uuidv7(), assetId: a.id, day: "2026-10-05", amountCentimes: "1", paidWith: "cash", treasuryId: null }, clock), role).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await disposeFixedAsset(ctx, { assetId: a.id, day: "2028-01-05", priceCentimes: "0", receivedIn: "cash", treasuryId: null }, clock), role).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await attachFixedAssetReceipt(ctx, a.id, uuidv7()), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(await entriesOf(a.id)).toBe(0);
    expect(await createFixedAsset(owner, a, clock)).toEqual({ ok: true, value: undefined });
    for (const role of ["manager", "accountant"] as const) {
      const read = await assetRegister({ ...owner, role }, clock);
      if (!read.ok) throw new Error(read.error);
      expect(read.value.assets.find((x) => x.id === a.id)?.place, role).toBe("Ferme Sud · Bâtiment 1");
      expect(read.value.farms, role).toBeUndefined(); // the forms are the owner's
    }
    expect(await assetRegister({ ...owner, role: "worker" }, clock)).toEqual({ ok: false, error: "FORBIDDEN" });

    // Another organisation sees none of it, and can't reach it by id, nor use this organisation's house or bank.
    const theirs = await assetRegister(other, clock);
    if (!theirs.ok) throw new Error(theirs.error);
    expect(theirs.value.assets.some((x) => x.id === a.id)).toBe(false);
    expect(theirs.value.farms?.map((f) => f.name)).toEqual(["Ferme C"]);
    expect(await createFixedAsset(other, a, clock)).toEqual({ ok: false, error: "ALREADY_EXISTS" });
    expect(await updateFixedAsset(other, { assetId: a.id, lifeMonths: 60, residualCentimes: "0" })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await disposeFixedAsset(other, { assetId: a.id, day: "2028-01-05", priceCentimes: "0", receivedIn: "cash", treasuryId: null }, clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await payFixedAsset(other, { id: uuidv7(), assetId: a.id, day: "2026-10-05", amountCentimes: "1", paidWith: "cash", treasuryId: null }, clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await attachFixedAssetReceipt(other, a.id, uuidv7())).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await createFixedAsset(other, generator({ houseId: house }), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await createFixedAsset(owner, generator({ houseId: otherHouse }), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await createFixedAsset(other, generator({ paidWith: "transfer", treasuryId: bank }), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await db.fixedAsset.findUnique({ where: { id: a.id } })).toMatchObject({ organizationId: owner.organizationId, lifeMonths: 84, disposedOn: null });
  });

  it("attaches the invoice once, to the organisation's own asset (ADR-011)", async () => {
    const a = generator();
    expect(await createFixedAsset(owner, a, clock)).toEqual({ ok: true, value: undefined });
    const file = uuidv7();
    expect(await attachFixedAssetReceipt(owner, a.id, file)).toEqual({ ok: true, value: undefined });
    expect(await attachFixedAssetReceipt(owner, a.id, uuidv7())).toEqual({ ok: false, error: "FILE_ALREADY_ATTACHED" });
    const register = await assetRegister(owner, clock);
    if (!register.ok) throw new Error(register.error);
    expect(register.value.assets.find((x) => x.id === a.id)?.receiptFileId).toBe(file);
  });
});
