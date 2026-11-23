import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, closePreview, createFixedAsset, createSubsidy, readBooks, runClose, setPeriodLocked, subsidyRegister, updateFixedAsset } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant, twoTenants } from "@/test/tenant";

const clock = fixedClock("2028-06-15T10:00:00Z");
const OK = { ok: true, value: undefined };
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
const land = () => ({ id: uuidv7(), label: "Terrain", category: "land", acquiredOn: "2026-02-01", inServiceOn: "2026-02-01", amountCentimes: "20000000", lifeMonths: null, paidWith: "cash" });
// §7.1 A: a subsidy of 14 205,00 on the generator, received on 5 Oct 2026.
const subsidyA = (treasuryId: string, assetIds: string[], more: object = {}) => ({
  id: uuidv7(),
  label: "Aide à l’équipement",
  grantor: "Fonds de développement agricole",
  amountCentimes: "1420500",
  receivedOn: "2026-10-05",
  treasuryId,
  assetIds,
  ...more,
});
const linesOf = async (sourceId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceModule: "finance", sourceId } }, include: { entry: true }, orderBy: [{ entry: { id: "asc" } }, { debitCentimes: "desc" }] })).map((l) => [
    l.entry.sourceVersion,
    l.entry.journal,
    l.entry.day.toISOString().slice(0, 10),
    l.account,
    l.debitCentimes,
    l.creditCentimes,
  ]);

describe("investment subsidies (SPEC-finance FC2, FQ17, T106)", () => {
  let owner: TenantContext, cashBook: TenantContext, other: TenantContext;
  let entity: string, otherEntity: string;
  const [bank, box, cashBookBank, otherBank] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const asset = generator();
  const a = subsidyA(bank, [asset.id]);

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [owner, cashBook] = await twoTenants(); // an individual farmer keeps the receipts-and-expenses book (FN1)
    other = await tenant("+212600000003", "Ferme C");
    entity = (await listLegalEntities(owner))[0].id;
    otherEntity = (await listLegalEntities(other))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    expect(await changeAccountingChoices(other, otherEntity, { books: "ledger", pcaOverlay: false, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true }); // FN2: CGNC only
    await db.treasuryAccount.createMany({
      data: [
        { id: bank, organizationId: owner.organizationId, kind: "bank", name: "Banque Populaire" },
        { id: box, organizationId: owner.organizationId, kind: "cash", name: "Caisse ferme" },
        { id: cashBookBank, organizationId: cashBook.organizationId, kind: "bank", name: "CIH" },
        { id: otherBank, organizationId: other.organizationId, kind: "bank", name: "Attijariwafa" },
      ],
    });
    expect(await createFixedAsset(owner, asset, clock)).toEqual(OK);
  });

  it("§7.1 A: posts the receipt D 5141 / C 1311 on its day, once; the close run releases 676,43 in 2026 and 2 029,29 in 2027, D 1319 / C 7577", async () => {
    expect(await createSubsidy(owner, a, clock)).toEqual(OK);
    expect(await createSubsidy(owner, a, clock)).toEqual(OK); // the same form twice: one subsidy, one entry
    expect(await linesOf(`subsidy:${a.id}:receipt`)).toEqual([
      [1, "BQ", "2026-10-05", "5141", 1_420_500n, 0n],
      [1, "BQ", "2026-10-05", "1311", 0n, 1_420_500n],
    ]);
    const receipt = await db.journalLine.findFirstOrThrow({ where: { account: "5141", entry: { sourceId: `subsidy:${a.id}:receipt` } } });
    expect(receipt.treasuryId).toBe(bank);
    expect(await db.auditEvent.count({ where: { entity: "Subsidy", entityId: a.id, action: "create" } })).toBe(1);

    const preview = await closePreview(owner, 2026, clock);
    expect(preview.ok && preview.value.entries.map((e) => [e.kind, e.action, e.lines.map((l) => [l.account, l.label, l.debit, l.credit])])).toEqual([
      ["depreciation", "post", [["61933", expect.any(String), 225_476n, 0n], ["28332", expect.any(String), 0n, 225_476n]]],
      ["subsidy", "post", [["1319", "Subventions d’investissement inscrites au compte de produits et charges", 67_643n, 0n], ["7577", "Reprises sur subventions d’investissement de l’exercice", 0n, 67_643n]]],
      ["stock", "none", []], // T108: no stock in this file
      ["batch", "none", []], // T109: no batch either
      ["hens", "none", []], // T114, T115: no layer or pullet batch
      ["provision", "none", []],
    ]);
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 2 });
    expect(await runClose(owner, { year: 2027 }, clock)).toEqual({ ok: true, value: 2 });
    expect(await linesOf(`close:subsidy:${entity}:2026`)).toEqual([
      [1, "OD", "2026-12-31", "1319", 67_643n, 0n],
      [1, "OD", "2026-12-31", "7577", 0n, 67_643n],
    ]);
    expect(await linesOf(`close:subsidy:${entity}:2027`)).toEqual([
      [1, "OD", "2027-12-31", "1319", 202_929n, 0n],
      [1, "OD", "2027-12-31", "7577", 0n, 202_929n],
    ]);
    expect(await db.journalEntry.findFirstOrThrow({ where: { sourceId: `close:subsidy:${entity}:2026` } })).toMatchObject({ label: "Quote-part des subventions d’investissement virée au résultat", createdBy: owner.userId });

    // "Emprunts et subventions": the release by year, adding up to the subsidy.
    const register = await subsidyRegister(owner);
    if (!register.ok) throw new Error(register.error);
    const [view] = register.value.subsidies;
    expect(view).toMatchObject({ label: "Aide à l’équipement", grantor: "Fonds de développement agricole", amount: 1_420_500n, receivedOn: "2026-10-05", bank: "Banque Populaire", assets: ["Groupe électrogène"] });
    expect(view.years.slice(0, 2).map((y) => [y.from, y.release])).toEqual([["2026-01-01", 67_643n], ["2027-01-01", 202_929n]]);
    expect(view.years.at(-1)).toMatchObject({ from: "2033-01-01", released: 1_420_500n });
    expect(register.value.assets).toEqual([{ id: asset.id, label: "Groupe électrogène" }]);
  });

  it("posts nothing when the close runs again with the same facts; a changed life posts a reversal and a new release", async () => {
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await runClose(owner, { year: 2027 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await closePreview(owner, 2026, clock)).toMatchObject({ ok: true, value: { entries: [{ action: "unchanged" }, { kind: "subsidy", action: "unchanged" }, { kind: "stock" }, { kind: "batch" }, { kind: "hens" }, { kind: "provision" }] } });
    expect(await db.journalEntry.count({ where: { sourceId: { startsWith: "close:subsidy:" } } })).toBe(2);

    // 84 → 60 months: 2026 cumulative 315 667, released 0,3 × 315 667 = 94 700,1 → 94 700.
    expect(await updateFixedAsset(owner, { assetId: asset.id, lifeMonths: 60, residualCentimes: "0" })).toEqual(OK);
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 4 }); // each kind: the reversal and version 2
    expect((await linesOf(`close:subsidy:${entity}:2026`)).filter((l) => l[0] === 2)).toEqual([
      [2, "OD", "2026-12-31", "1319", 94_700n, 0n],
      [2, "OD", "2026-12-31", "7577", 0n, 94_700n],
    ]);
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await updateFixedAsset(owner, { assetId: asset.id, lifeMonths: 84, residualCentimes: "0" })).toEqual(OK);
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 4 }); // back to §7.1 A
  });

  it("refuses a subsidy on land only, on land and another asset, or on no asset (FQ17); nothing is posted or kept", async () => {
    const plot = land();
    const kept = generator({ label: "Silo", amountCentimes: "100000", residualCentimes: "100000" }); // its base is 0
    expect(await createFixedAsset(owner, plot, clock)).toEqual(OK);
    expect(await createFixedAsset(owner, kept, clock)).toEqual(OK);
    const before = await db.journalEntry.count();
    expect(await createSubsidy(owner, subsidyA(bank, [plot.id]), clock)).toEqual({ ok: false, error: "SUBSIDY_ON_LAND" });
    expect(await createSubsidy(owner, subsidyA(bank, [plot.id, asset.id]), clock)).toEqual({ ok: false, error: "SUBSIDY_ON_LAND" });
    expect(await createSubsidy(owner, subsidyA(bank, []), clock)).toEqual({ ok: false, error: "SUBSIDY_NO_ASSET" });
    expect(await createSubsidy(owner, subsidyA(bank, [kept.id]), clock)).toEqual({ ok: false, error: "SUBSIDY_NO_ASSET" });
    // Other refusals: a cash box, a day not yet come, a locked month, an asset or a bank account of another organisation.
    expect(await createSubsidy(owner, subsidyA(box, [asset.id]), clock)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await createSubsidy(owner, subsidyA(bank, [asset.id], { receivedOn: "2028-06-20" }), clock)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(await createSubsidy(owner, subsidyA(bank, [asset.id], { amountCentimes: "0" }), clock)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await setPeriodLocked(owner, entity, "2027-06", true)).toEqual(OK);
    expect(await createSubsidy(owner, subsidyA(bank, [asset.id], { receivedOn: "2027-06-10" }), clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await setPeriodLocked(owner, entity, "2027-06", false)).toEqual(OK);
    expect(await createSubsidy(other, subsidyA(otherBank, [asset.id]), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await createSubsidy(other, subsidyA(bank, []), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await db.journalEntry.count()).toBe(before);
    expect(await db.subsidy.count({ where: { organizationId: owner.organizationId } })).toBe(1);
  });

  it("is the owner's to write; the manager and the accountant read; workers and other organisations get nothing", async () => {
    const [manager, accountant, worker] = (["manager", "accountant", "worker"] as const).map((role) => ({ ...owner, role }));
    for (const who of [manager, accountant, worker]) {
      expect(await createSubsidy(who, subsidyA(bank, [asset.id]), clock), who.role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    for (const who of [manager, accountant]) {
      const read = await subsidyRegister(who);
      expect(read.ok && read.value.subsidies.map((s) => s.id), who.role).toEqual([a.id]);
    }
    expect(await subsidyRegister(worker)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await createSubsidy(other, { ...subsidyA(otherBank, []), id: a.id }, clock)).toEqual({ ok: false, error: "ALREADY_EXISTS" });
    const theirs = await subsidyRegister(other);
    expect(theirs.ok && theirs.value).toEqual({ subsidies: [], assets: [] });
  });

  it("lands on 5141, 1311, 1319 and 7577 with the PCA off too", async () => {
    const theirs = generator();
    expect(await createFixedAsset(other, theirs, clock)).toEqual(OK);
    const s = subsidyA(otherBank, [theirs.id]);
    expect(await createSubsidy(other, s, clock)).toEqual(OK);
    expect(await runClose(other, { year: 2026 }, clock)).toEqual({ ok: true, value: 2 });
    expect((await linesOf(`subsidy:${s.id}:receipt`)).map((l) => l[3])).toEqual(["5141", "1311"]);
    expect((await linesOf(`close:subsidy:${otherEntity}:2026`)).map((l) => [l[3], l[4], l[5]])).toEqual([["1319", 67_643n, 0n], ["7577", 0n, 67_643n]]);
  });

  it("works for a cash_book entity: the receipt shows in its cash book; no release, since it has no close run (FCX4)", async () => {
    const theirs = generator();
    expect(await createFixedAsset(cashBook, theirs, clock)).toEqual(OK); // the register only (FQ27)
    const s = subsidyA(cashBookBank, [theirs.id]);
    expect(await createSubsidy(cashBook, s, clock)).toEqual(OK);
    const october = await readBooks(cashBook, "2026-10");
    if (!october.ok) throw new Error("books");
    expect(october.value.cashBook.rows.map((r) => [r.day, r.label, r.account, r.counterAccounts, r.receipt, r.expense])).toEqual([
      ["2026-10-05", "Subvention d’investissement : Aide à l’équipement", "5141", ["1311"], 1_420_500n, 0n],
    ]);
    expect(await closePreview(cashBook, 2026, clock)).toMatchObject({ ok: true, value: { books: "cash_book", entries: [] } });
    expect(await runClose(cashBook, { year: 2026 }, clock)).toEqual({ ok: false, error: "CASH_BOOK_NO_CLOSE" });
    const register = await subsidyRegister(cashBook);
    expect(register.ok && register.value.subsidies[0].years[0].release).toBe(67_643n); // the schedule only
  });
});
