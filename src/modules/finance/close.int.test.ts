import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, closePreview, createFixedAsset, disposeFixedAsset, runClose, saveYearEndCount, setPeriodLocked, updateFixedAsset, yearEndCount } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant, twoTenants } from "@/test/tenant";

const clock = fixedClock("2028-06-15T10:00:00Z");
const NO_SUBSIDY = { kind: "subsidy", action: "none", lines: [] }; // T106: no subsidy in this file
// T108: no stock in this file either, so no stock entry and no provision.
const NOTHING_ELSE = [NO_SUBSIDY, { kind: "stock", action: "none", lines: [] }, { kind: "batch", action: "none", lines: [] }, { kind: "provision", action: "none", lines: [] }];
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
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });

/** The close entries of an entity's year, the reversals with them: [version, journal, day, account, debit, credit, reverses]. */
async function closeLines(entityId: string, year: number) {
  const source = `close:depreciation:${entityId}:${year}`;
  const posted = await db.journalEntry.findMany({ where: { sourceModule: "finance", sourceId: source }, select: { id: true } });
  const ids = posted.map((e) => e.id);
  const lines = await db.journalLine.findMany({
    where: { entry: { OR: [{ id: { in: ids } }, { reversesId: { in: ids } }] } },
    include: { entry: true },
    orderBy: [{ entry: { id: "asc" } }, { debitCentimes: "desc" }],
  });
  return lines.map((l) => [l.entry.sourceVersion, l.entry.journal, l.entry.day.toISOString().slice(0, 10), l.account, l.debitCentimes, l.creditCentimes, l.entry.reversesId ? ids.indexOf(l.entry.reversesId) + 1 : null]);
}

describe("the close run, depreciation first (SPEC-finance FCX4, FC1, T103)", () => {
  let owner: TenantContext, cashBook: TenantContext, other: TenantContext;
  let entity: string, otherEntity: string;

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [owner, cashBook] = await twoTenants();
    other = await tenant("+212600000003", "Ferme C");
    entity = (await listLegalEntities(owner))[0].id;
    otherEntity = (await listLegalEntities(other))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    expect(await changeAccountingChoices(other, otherEntity, { books: "ledger", pcaOverlay: false, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true }); // FN2: CGNC only
  });

  it("§7.1 A's 2026 run posts D 6193 / C 2833 2 254,76 on 31 Dec 2026, shown first as a preview", async () => {
    expect(await createFixedAsset(owner, generator(), clock)).toEqual({ ok: true, value: undefined });
    const preview = await closePreview(owner, 2026, clock);
    expect(preview).toEqual({
      ok: true,
      value: {
        year: 2026,
        day: "2026-12-31",
        books: "ledger",
        locked: false,
        closedOn: null,
        frozen: false,
        opening: null, // 2025 has no entry: the first year is opened by hand (FCX3)
        entries: [
          {
            kind: "depreciation",
            action: "post",
            lines: [
              { account: "6193", label: "Dotations d’exploitation aux amortissements des immobilisations corporelles", debit: 225_476n, credit: 0n },
              { account: "2833", label: "Amortissements des installations techniques, matériel et outillage", debit: 0n, credit: 225_476n },
            ],
          },
          ...NOTHING_ELSE,
        ],
        stocks: [],
        batches: [],
        eggs: [],
      },
    });
    expect(await db.journalEntry.count({ where: { sourceId: { startsWith: "close:" } } })).toBe(0); // the preview posts nothing

    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 1 });
    expect(await closeLines(entity, 2026)).toEqual([
      [1, "OD", "2026-12-31", "6193", 225_476n, 0n, null],
      [1, "OD", "2026-12-31", "2833", 0n, 225_476n, null],
    ]);
    const entry = await db.journalEntry.findFirstOrThrow({ where: { sourceId: `close:depreciation:${entity}:2026` } });
    expect(entry).toMatchObject({ label: "Dotations aux amortissements de l’exercice", legalEntityId: entity, createdBy: owner.userId });
    expect(await db.auditEvent.count({ where: { entity: "JournalEntry", entityId: entry.id, action: "create" } })).toBe(1);
  });

  it("posts nothing for the same facts; a changed life posts a reversal and a new version; figures now zero, the reversal alone", async () => {
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await closePreview(owner, 2026, clock)).toMatchObject({ ok: true, value: { entries: [{ action: "unchanged" }, ...NOTHING_ELSE] } });

    const asset = await db.fixedAsset.findFirstOrThrow({ where: { organizationId: owner.organizationId } });
    expect(await updateFixedAsset(owner, { assetId: asset.id, lifeMonths: 60, residualCentimes: "0" })).toEqual({ ok: true, value: undefined });
    expect(await closePreview(owner, 2026, clock)).toMatchObject({ ok: true, value: { entries: [{ action: "repost", lines: [{ debit: 315_667n }, { credit: 315_667n }] }, ...NOTHING_ELSE] } });
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 2 }); // 4 735 000 × 4 ÷ 60 = 315 666,67
    expect(await closeLines(entity, 2026)).toEqual([
      [1, "OD", "2026-12-31", "6193", 225_476n, 0n, null],
      [1, "OD", "2026-12-31", "2833", 0n, 225_476n, null],
      [null, "OD", "2026-12-31", "2833", 225_476n, 0n, 1], // the reversal of version 1, on the same day
      [null, "OD", "2026-12-31", "6193", 0n, 225_476n, 1],
      [2, "OD", "2026-12-31", "6193", 315_667n, 0n, null],
      [2, "OD", "2026-12-31", "2833", 0n, 315_667n, null],
    ]);
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 });

    // Disposed of in 2026: the disposal posts its months, so the close has nothing left for 2026.
    expect(await disposeFixedAsset(owner, { assetId: asset.id, day: "2026-11-15", priceCentimes: "0", receivedIn: "cash", treasuryId: null }, clock)).toEqual({ ok: true, value: undefined });
    expect(await closePreview(owner, 2026, clock)).toMatchObject({ ok: true, value: { entries: [{ action: "reverse", lines: [{ debit: 315_667n }, { credit: 315_667n }] }, ...NOTHING_ELSE] } });
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 1 });
    expect((await closeLines(entity, 2026)).slice(6)).toEqual([
      [null, "OD", "2026-12-31", "2833", 315_667n, 0n, 2],
      [null, "OD", "2026-12-31", "6193", 0n, 315_667n, 2],
    ]);
    expect(await db.journalEntry.count({ where: { sourceId: `close:depreciation:${entity}:2026` } })).toBe(2); // no third version
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await closePreview(owner, 2026, clock)).toMatchObject({ ok: true, value: { entries: [{ action: "none", lines: [] }, ...NOTHING_ELSE] } });
  });

  it("posts one credit per depreciation account with the PCA off; land and assets disposed of in the year stay out", async () => {
    const assets = [
      generator({ category: "installation" }), // 2 254,76 on 2833
      generator({ label: "Camion", category: "transport", acquiredOn: "2026-01-10", inServiceOn: "2026-01-10", amountCentimes: "1200000", lifeMonths: 60 }), // 12 months: 2 400,00 on 2834
      generator({ label: "Terrain", category: "land", lifeMonths: null, amountCentimes: "30000000" }),
      generator({ label: "Bascule" }),
    ];
    for (const a of assets) expect(await createFixedAsset(other, a, clock)).toEqual({ ok: true, value: undefined });
    expect(await disposeFixedAsset(other, { assetId: assets[3].id, day: "2026-12-20", priceCentimes: "0", receivedIn: "cash", treasuryId: null }, clock)).toEqual({ ok: true, value: undefined });
    expect(await runClose(other, { year: 2026 }, clock)).toEqual({ ok: true, value: 1 });
    expect(await closeLines(otherEntity, 2026)).toEqual([
      [1, "OD", "2026-12-31", "6193", 465_476n, 0n, null],
      [1, "OD", "2026-12-31", "2833", 0n, 225_476n, null],
      [1, "OD", "2026-12-31", "2834", 0n, 240_000n, null],
    ]);
    expect(await closeLines(entity, 2026)).toHaveLength(8); // each organisation its own assets and entries
  });

  it("is refused while the year's last month is locked, and for a cash_book entity", async () => {
    expect(await createFixedAsset(owner, generator({ acquiredOn: "2027-03-01", inServiceOn: "2027-03-01" }), clock)).toEqual({ ok: true, value: undefined });
    expect(await setPeriodLocked(owner, entity, "2027-12", true)).toEqual({ ok: true, value: undefined });
    expect(await closePreview(owner, 2027, clock)).toMatchObject({ ok: true, value: { locked: true, entries: [{ action: "post" }, ...NOTHING_ELSE] } });
    expect(await runClose(owner, { year: 2027 }, clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await db.journalEntry.count({ where: { sourceId: `close:depreciation:${entity}:2027` } })).toBe(0); // not moved to another month
    expect(await setPeriodLocked(owner, entity, "2027-12", false)).toEqual({ ok: true, value: undefined });
    expect(await runClose(owner, { year: 2029 }, clock)).toEqual({ ok: false, error: "DAY_IN_FUTURE" }); // not begun on 15 Jun 2028

    // An individual farmer keeps the receipts-and-expenses book: no balance sheet, no close entries.
    expect(await createFixedAsset(cashBook, generator(), clock)).toEqual({ ok: true, value: undefined });
    expect(await runClose(cashBook, { year: 2026 }, clock)).toEqual({ ok: false, error: "CASH_BOOK_NO_CLOSE" });
    expect(await closePreview(cashBook, 2026, clock)).toEqual({ ok: true, value: { year: 2026, day: "2026-12-31", books: "cash_book", locked: false, closedOn: null, frozen: false, opening: null, entries: [], stocks: [], batches: [], eggs: [] } });
    const cashEntity = (await listLegalEntities(cashBook))[0].id;
    expect(await db.journalEntry.count({ where: { legalEntityId: cashEntity } })).toBe(0);
  });

  it("freezes the year's count once its run has posted", async () => {
    const ids = { farm: uuidv7(), supplier: uuidv7(), feed: uuidv7() };
    const pushed = await push(
      owner,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
        m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: "2026-09-01", quantity: 4_000_000, unitPriceCentimes: "460", paidCentimes: "0", dueOn: null }),
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);

    // 2027: counted before the run, frozen after it, for the owner and the manager alike.
    expect(await saveYearEndCount({ ...owner, role: "manager" }, { year: 2027, counts: { [ids.feed]: "3 990" } })).toEqual({ ok: true, value: 1 });
    expect(await yearEndCount(owner, 2027, clock)).toMatchObject({ ok: true, value: { frozen: false } });
    expect(await runClose(owner, { year: 2027 }, clock)).toEqual({ ok: true, value: 2 }); // the 2027 depreciation and the feed in stock (T108)
    expect(await yearEndCount(owner, 2027, clock)).toMatchObject({ ok: true, value: { frozen: true } });
    for (const ctx of [owner, { ...owner, role: "manager" as const }]) {
      expect(await saveYearEndCount(ctx, { year: 2027, counts: { [ids.feed]: "3 980" } }), ctx.role).toEqual({ ok: false, error: "COUNT_FROZEN" });
      expect(await saveYearEndCount(ctx, { year: 2027, counts: { [ids.feed]: "" } }), ctx.role).toEqual({ ok: false, error: "COUNT_FROZEN" });
    }
    const counted = await db.yearEndCount.findMany({ where: { organizationId: owner.organizationId }, select: { day: true, quantity: true } });
    expect(counted.map((c) => [c.day.toISOString().slice(0, 10), c.quantity])).toEqual([["2027-12-31", 3_990_000]]);
    // Another year's count is still open: 2028 has no run yet.
    expect(await saveYearEndCount(owner, { year: 2028, counts: { [ids.feed]: "3 990" } })).toEqual({ ok: true, value: 1 });
  });

  it("is the owner's to run; the manager and the accountant see the preview; workers get nothing", async () => {
    for (const role of ["manager", "accountant"] as const) {
      const ctx = { ...other, role };
      expect(await closePreview(ctx, 2026, clock), role).toMatchObject({ ok: true, value: { entries: [{ kind: "depreciation", action: "unchanged", lines: [{ account: "6193", debit: 465_476n }, {}, {}] }, ...NOTHING_ELSE] } });
      expect(await runClose(ctx, { year: 2026 }, clock), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(await closePreview({ ...other, role: "worker" }, 2026, clock)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await runClose({ ...other, role: "worker" }, { year: 2026 }, clock)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await runClose(owner, { year: "2026" }, clock)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});
