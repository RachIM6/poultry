import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import {
  changeAccountingChoices,
  closeFiscalYear,
  closePreview,
  createFixedAsset,
  readBooks,
  reopenFiscalYear,
  runClose,
  setPeriodLocked,
  updateFixedAsset,
} from "@/modules/finance";
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

const noZeros = (m: Map<string, bigint>) => Object.fromEntries([...m].filter(([, b]) => b !== 0n).sort(([a], [b]) => a.localeCompare(b)));

/** Σdebit − Σcredit per account of an entity's entries dated `from`–`to` (and matching `where`), straight from the lines. */
async function balances(entity: string, from: string, to: string, where: object = {}) {
  const lines = await db.journalLine.findMany({
    where: { entry: { legalEntityId: entity, day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, ...where } },
    select: { account: true, debitCentimes: true, creditCentimes: true },
  });
  const m = new Map<string, bigint>();
  for (const l of lines) m.set(l.account, (m.get(l.account) ?? 0n) + l.debitCentimes - l.creditCentimes);
  return m;
}

/** What one source's entries amount to, every version with its reversals. */
async function netOf(entity: string, day: string, sourceId: string) {
  const ids = (await db.journalEntry.findMany({ where: { sourceModule: "finance", sourceId }, select: { id: true } })).map((e) => e.id);
  return noZeros(await balances(entity, day, day, { OR: [{ id: { in: ids } }, { reversesId: { in: ids } }] }));
}

/** SPEC-finance §8 M6 2: the closing classes 1–5, and the result of classes 6–7 on 1191 (profit) or 1199 (loss). */
function expectedOpening(closing: Map<string, bigint>) {
  const m = new Map<string, bigint>();
  let result = 0n; // negative: a profit (credit)
  for (const [account, b] of closing) if (/^[1-5]/.test(account)) m.set(account, (m.get(account) ?? 0n) + b);
  else result += b;
  const resultAccount = result < 0n ? "1191" : "1199";
  m.set(resultAccount, (m.get(resultAccount) ?? 0n) + result);
  return noZeros(m);
}

/** The à-nouveaux of the year after [from, to] equals that year's closing (FCX5: "the opening always equals the closing"). */
async function expectOpeningEqualsClosing(entity: string, from: string, to: string, next: string) {
  expect(await netOf(entity, next, `opening:${entity}:${next}`)).toEqual(expectedOpening(await balances(entity, from, to)));
}

describe("the year close and the opening (SPEC-finance FCX5, FCX6, T104)", () => {
  let owner: TenantContext, cashBook: TenantContext, entity: string;

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [owner, cashBook] = await twoTenants();
    entity = (await listLegalEntities(owner))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
  });

  it("closes 2026 once its run has posted: every month locked, who and when, the 2027 à-nouveaux equal to the closing; a second close posts nothing", async () => {
    expect(await createFixedAsset(owner, generator(), clock)).toEqual({ ok: true, value: undefined });
    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: false, error: "CLOSE_RUN_PENDING" }); // run the close first
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 1 });
    expect(await closeFiscalYear(owner, { year: 2026 }, fixedClock("2026-12-31T20:00:00Z"))).toEqual({ ok: false, error: "YEAR_NOT_ENDED" });
    expect(await db.lockedPeriod.count({ where: { legalEntityId: entity } })).toBe(0); // refusals write nothing

    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 1 }); // the à-nouveaux; depreciation isn't reversed
    const locks = await db.lockedPeriod.findMany({ where: { legalEntityId: entity }, orderBy: { month: "asc" } });
    expect(locks.map((l) => l.month)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m) => `2026-${m}`));
    expect(await db.auditEvent.count({ where: { entity: "LockedPeriod", entityId: entity, action: "lock" } })).toBe(12);
    expect(await db.fiscalYearClose.findMany({ where: { legalEntityId: entity } })).toEqual([
      { organizationId: owner.organizationId, legalEntityId: entity, day: new Date("2026-12-31T00:00:00Z"), closedBy: owner.userId, closedAt: clock.now() },
    ]);
    expect(await db.auditEvent.count({ where: { entity: "FiscalYearClose", entityId: entity, action: "close", userId: owner.userId } })).toBe(1);

    const opening = await db.journalEntry.findFirstOrThrow({ where: { sourceId: `opening:${entity}:2027-01-01` }, include: { lines: true } });
    expect(opening).toMatchObject({ journal: "OD", label: "À-nouveaux", sourceVersion: 1, day: new Date("2027-01-01T00:00:00Z") });
    await expectOpeningEqualsClosing(entity, "2026-01-01", "2026-12-31", "2027-01-01");
    // §7.1 A, paid in cash: the generator at cost, its 2026 depreciation, the cash out; the loss is the depreciation.
    expect(await netOf(entity, "2027-01-01", `opening:${entity}:2027-01-01`)).toEqual({ "1199": 225_476n, "2332": 4_735_000n, "2833": -225_476n, "5161": -4_735_000n });
    expect(await db.journalEntry.count({ where: { sourceId: { startsWith: "reversal:" } } })).toBe(0);

    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await db.auditEvent.count({ where: { entity: "LockedPeriod", entityId: entity, action: "lock" } })).toBe(12);
    expect(await db.journalEntry.count({ where: { legalEntityId: entity, day: new Date("2027-01-01T00:00:00Z") } })).toBe(1);
    expect(await closePreview(owner, 2026, clock)).toMatchObject({ ok: true, value: { locked: true, closedOn: "2028-06-15", entries: [{ action: "unchanged" }, ...NOTHING_ELSE] } });
  });

  it("after a later change to a close entry (reopen, run, close again), posts the à-nouveaux again by reversal and new version: still equal to the closing", async () => {
    const asset = await db.fixedAsset.findFirstOrThrow({ where: { organizationId: owner.organizationId } });
    expect(await updateFixedAsset(owner, { assetId: asset.id, lifeMonths: 60, residualCentimes: "0" })).toEqual({ ok: true, value: undefined });
    expect(await closePreview(owner, 2026, clock)).toMatchObject({ ok: true, value: { entries: [{ action: "repost" }, ...NOTHING_ELSE] } });
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" }); // the year is closed
    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: false, error: "CLOSE_RUN_PENDING" });

    // Reopening unlocks the last month only, audited; the year is no longer closed.
    expect(await reopenFiscalYear(owner, { year: 2026 })).toEqual({ ok: true, value: undefined });
    expect((await db.lockedPeriod.findMany({ where: { legalEntityId: entity } })).map((l) => l.month)).not.toContain("2026-12");
    expect(await db.lockedPeriod.count({ where: { legalEntityId: entity } })).toBe(11);
    expect(await db.auditEvent.findFirst({ where: { entity: "FiscalYearClose", entityId: entity, action: "reopen" } })).toMatchObject({
      userId: owner.userId,
      before: { day: "2026-12-31", closedBy: owner.userId },
    });
    expect(await db.auditEvent.count({ where: { entity: "LockedPeriod", entityId: entity, action: "unlock" } })).toBe(1);
    expect(await closePreview(owner, 2026, clock)).toMatchObject({ ok: true, value: { locked: false, closedOn: null } });
    expect(await reopenFiscalYear(owner, { year: 2026 })).toEqual({ ok: false, error: "YEAR_NOT_CLOSED" });

    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 2 }); // 4 735 000 × 4 ÷ 60 = 315 666,67
    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 2 }); // the à-nouveaux: reversal and version 2
    const openings = await db.journalEntry.findMany({ where: { legalEntityId: entity, day: new Date("2027-01-01T00:00:00Z") }, orderBy: { id: "asc" } });
    expect(openings.map((e) => [e.label, e.sourceVersion, e.reversesId])).toEqual([
      ["À-nouveaux", 1, null],
      ["Annulation", null, openings[0].id],
      ["À-nouveaux", 2, null],
    ]);
    await expectOpeningEqualsClosing(entity, "2026-01-01", "2026-12-31", "2027-01-01");
    expect(await netOf(entity, "2027-01-01", `opening:${entity}:2027-01-01`)).toMatchObject({ "1199": 315_667n, "2833": -315_667n });
    expect(await db.lockedPeriod.count({ where: { legalEntityId: entity } })).toBe(12);
  });

  it("closes years in order: the previous one first, reopening refused while the next one is closed", async () => {
    expect(await runClose(owner, { year: 2027 }, clock)).toEqual({ ok: true, value: 1 });
    expect(await closeFiscalYear(owner, { year: 2028 }, fixedClock("2029-02-01T10:00:00Z"))).toEqual({ ok: false, error: "PREVIOUS_YEAR_OPEN" });
    expect(await setPeriodLocked(owner, entity, "2028-01", true)).toEqual({ ok: true, value: undefined });
    expect(await closeFiscalYear(owner, { year: 2027 }, clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" }); // the opening isn't moved
    expect(await db.fiscalYearClose.count({ where: { legalEntityId: entity } })).toBe(1);
    expect(await db.lockedPeriod.count({ where: { legalEntityId: entity, month: { startsWith: "2027" } } })).toBe(0);
    expect(await setPeriodLocked(owner, entity, "2028-01", false)).toEqual({ ok: true, value: undefined });

    expect(await closeFiscalYear(owner, { year: 2027 }, clock)).toEqual({ ok: true, value: 1 });
    await expectOpeningEqualsClosing(entity, "2027-01-01", "2027-12-31", "2028-01-01");
    expect(await reopenFiscalYear(owner, { year: 2026 })).toEqual({ ok: false, error: "NEXT_YEAR_CLOSED" });
    expect(await db.lockedPeriod.count({ where: { legalEntityId: entity, month: "2026-12" } })).toBe(1);
  });

  it("refuses a cash_book entity, which has no close run, with the reason", async () => {
    expect(await createFixedAsset(cashBook, generator(), clock)).toEqual({ ok: true, value: undefined });
    expect(await closeFiscalYear(cashBook, { year: 2026 }, clock)).toEqual({ ok: false, error: "CASH_BOOK_NO_CLOSE" });
    expect(await reopenFiscalYear(cashBook, { year: 2026 })).toEqual({ ok: false, error: "YEAR_NOT_CLOSED" });
    expect(await closeFiscalYear(owner, { year: "2026" }, clock)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("is the owner's: the manager and the accountant see the status, workers nothing, each organisation its own", async () => {
    for (const role of ["manager", "accountant"] as const) {
      const ctx = { ...owner, role };
      expect(await closePreview(ctx, 2027, clock), role).toMatchObject({ ok: true, value: { locked: true, closedOn: "2028-06-15" } });
      expect(await readBooks(ctx, "2027-12"), role).toMatchObject({ ok: true, value: { closedOn: "2028-06-15" } });
      expect(await readBooks(ctx, "2028-01"), role).toMatchObject({ ok: true, value: { closedOn: null } });
      expect(await closeFiscalYear(ctx, { year: 2027 }, clock), role).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await reopenFiscalYear(ctx, { year: 2027 }), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    const worker = { ...owner, role: "worker" as const };
    expect(await closePreview(worker, 2027, clock)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await closeFiscalYear(worker, { year: 2027 }, clock)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await reopenFiscalYear(worker, { year: 2027 })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await db.fiscalYearClose.count({ where: { legalEntityId: entity } })).toBe(2);

    const other = await tenant("+212600000003", "Ferme C");
    expect(await changeAccountingChoices(other, (await listLegalEntities(other))[0].id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    expect(await closePreview(other, 2027, clock)).toMatchObject({ ok: true, value: { locked: false, closedOn: null } });
    expect(await reopenFiscalYear(other, { year: 2027 })).toEqual({ ok: false, error: "YEAR_NOT_CLOSED" });
  });

  // SPEC-finance §8 M6 1: the trial balance stays balanced after the close run, the year close and the opening, and
  // the opening equals the closing, for random assets and lives (seeded, the same runs every time; no fast-check).
  it("keeps the books balanced and the opening equal to the closing over random assets, runs, closes and changes", async () => {
    let seed = 11;
    const next = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648), seed % n);
    const pad = (n: number) => String(n).padStart(2, "0");
    for (let run = 0; run < 8; run++) {
      const ctx = await tenant(`+2126110000${pad(run)}`, `Ferme ${run}`);
      const id = (await listLegalEntities(ctx))[0].id;
      expect(await changeAccountingChoices(ctx, id, { books: "ledger", pcaOverlay: run % 3 === 0 ? false : null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
      const assets = Array.from({ length: 1 + next(3) }, () => {
        const day = `${2025 + next(2)}-${pad(1 + next(12))}-${pad(1 + next(28))}`;
        return generator({
          category: ["equipment", "installation", "transport", "building", "computer"][next(5)],
          acquiredOn: day,
          inServiceOn: day,
          amountCentimes: String(1 + next(20_000_000)),
          lifeMonths: 1 + next(120),
          paidWith: ["cash", "credit"][next(2)],
        });
      });
      for (const a of assets) expect(await createFixedAsset(ctx, a, clock), JSON.stringify(a)).toEqual({ ok: true, value: undefined });

      const closeYear = async (year: number) => {
        expect(await runClose(ctx, { year }, clock)).toMatchObject({ ok: true });
        expect(await closeFiscalYear(ctx, { year }, clock), `${run} ${year}`).toMatchObject({ ok: true });
        await expectOpeningEqualsClosing(id, `${year}-01-01`, `${year}-12-31`, `${year + 1}-01-01`);
        for (const month of [`${year}-12`, `${year + 1}-01`]) {
          const books = await readBooks(ctx, month);
          if (!books.ok) throw new Error(books.error);
          expect(books.value.trialBalance?.balanced, `${run} ${month}`).toBe(true);
          expect(books.value.balanceSheet?.totalAssets, `${run} ${month}`).toBe(books.value.balanceSheet?.totalLiabilities);
        }
      };
      await closeYear(2025);
      await closeYear(2026);
      expect(await closeFiscalYear(ctx, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 }); // a second close posts nothing

      if (next(2) === 0) {
        // A later change: another life, the 2026 run again after reopening, and the close again.
        expect(await updateFixedAsset(ctx, { assetId: assets[0].id, lifeMonths: 1 + next(120), residualCentimes: "0" })).toMatchObject({ ok: true });
        expect(await reopenFiscalYear(ctx, { year: 2026 })).toEqual({ ok: true, value: undefined });
        await closeYear(2026);
      }
      const all = await balances(id, "2000-01-01", "2100-12-31");
      expect([...all.values()].reduce((s, b) => s + b, 0n), String(run)).toBe(0n);
    }
  }, 120_000); // 8 organisations closed over two years: about 55 s on a loaded Windows Docker, above the 30 s default
});
