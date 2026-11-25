import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, closeFiscalYear, closePreview, createFixedAsset, openFiscalYear, postEntry, reopenFiscalYear, runClose, type Line } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

// As in year-close-reversal.int.test.ts: depreciation stands in for a reversible close kind (FCX5), in this file only,
// so the opening reversals are checked over an early opening without a stock or batch setup.
vi.mock("@/modules/finance/domain/close", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/finance/domain/close")>()),
  REVERSED_AT_OPENING: { depreciation: true },
}));

const clock = fixedClock("2027-02-10T10:00:00Z"); // 2027 has begun, 2026 isn't closed
const line = (account: string, debit: bigint, credit: bigint): Line => ({ account, debit, credit });
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

/** What one source's entries amount to on `day`, every version with its reversals. */
async function netOf(entity: string, day: string, sourceId: string) {
  const ids = (await db.journalEntry.findMany({ where: { sourceModule: "finance", sourceId }, select: { id: true } })).map((e) => e.id);
  return noZeros(await balances(entity, day, day, { OR: [{ id: { in: ids } }, { reversesId: { in: ids } }] }));
}

/** The closing classes 1–5, and the result of classes 6–7 on 1191 (profit) or 1199 (loss). */
function expectedOpening(closing: Map<string, bigint>) {
  const m = new Map<string, bigint>();
  let result = 0n;
  for (const [account, b] of closing) if (/^[1-5]/.test(account)) m.set(account, (m.get(account) ?? 0n) + b);
  else result += b;
  const resultAccount = result < 0n ? "1191" : "1199";
  m.set(resultAccount, (m.get(resultAccount) ?? 0n) + result);
  return noZeros(m);
}

describe("opening a fiscal year before the previous one is closed (SPEC-finance FN3, FCX5, FCX6)", () => {
  let owner: TenantContext, cashBook: TenantContext, entity: string;
  const opening = () => `opening:${entity}:2027-01-01`;
  const reversal = () => `reversal:close:depreciation:${entity}:2026`;
  const post = (day: string, lines: Line[]) =>
    db.$transaction((tx) => postEntry(tx, owner, { id: uuidv7(), legalEntityId: entity, journal: "OD", day: day as FarmDay, label: "x", reversesId: null, lines }));
  const sale = (day: string, c: bigint) => post(day, [line("5161", c, 0n), line("712121", 0n, c)]);
  /** The opening's entries, oldest version first: [version, reversed]. */
  const versions = async () => {
    const entries = await db.journalEntry.findMany({ where: { sourceId: opening() }, orderBy: { sourceVersion: "asc" } });
    return Promise.all(entries.map(async (e) => [e.sourceVersion, (await db.journalEntry.count({ where: { reversesId: e.id } })) > 0]));
  };
  const expectOpeningEqualsClosing = async () => expect(await netOf(entity, "2027-01-01", opening())).toEqual(expectedOpening(await balances(entity, "2026-01-01", "2026-12-31")));

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [owner, cashBook] = await twoTenants(); // individuals: the second keeps its default cash_book
    entity = (await listLegalEntities(owner))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 }, fixedClock("2026-01-02T10:00:00Z"))).toMatchObject({ ok: true });
    // 2026: feed on credit 4 500,00, birds sold 8 000,00 cash, §7.1 A's generator 47 350,00 paid cash on 18 Sep.
    expect(await post("2026-03-01", [line("612122", 450_000n, 0n), line("4411", 0n, 450_000n)])).toMatchObject({ ok: true });
    expect(await sale("2026-09-01", 800_000n)).toMatchObject({ ok: true });
    const generator = { id: uuidv7(), label: "Groupe électrogène", category: "equipment", acquiredOn: "2026-09-18", inServiceOn: "2026-09-18", amountCentimes: "4735000", lifeMonths: 84, paidWith: "cash" };
    expect(await createFixedAsset(owner, generator, clock)).toEqual({ ok: true, value: undefined });
  });

  it("posts the 2027 à-nouveaux from 2026 as it stands: classes 1–5 carried forward, audited, provisional; a second click posts nothing", async () => {
    expect(await closePreview(owner, 2027, clock)).toMatchObject({ ok: true, value: { opening: "due" } });
    expect(await openFiscalYear(owner, { year: 2027 }, clock)).toEqual({ ok: true, value: 1 }); // no close entry to reverse yet

    const an = await db.journalEntry.findFirstOrThrow({ where: { sourceId: opening() } });
    expect(an).toMatchObject({ journal: "OD", label: "À-nouveaux", sourceVersion: 1, day: new Date("2027-01-01T00:00:00Z"), reversesId: null });
    expect(await netOf(entity, "2027-01-01", opening())).toEqual({ "1191": -350_000n, "23321": 4_735_000n, "4411": -450_000n, "5161": -3_935_000n });
    await expectOpeningEqualsClosing();
    expect(await db.auditEvent.count({ where: { entity: "JournalEntry", entityId: an.id, action: "create", userId: owner.userId } })).toBe(1);
    expect(await closePreview(owner, 2027, clock)).toMatchObject({ ok: true, value: { opening: "provisional", closedOn: null } });
    expect(await closePreview(owner, 2026, clock)).toMatchObject({ ok: true, value: { opening: null } }); // 2025 has no entry: opened by hand

    expect(await openFiscalYear(owner, { year: 2027 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await versions()).toEqual([[1, false]]);
  });

  it("refuses a cash_book entity, a year not begun and anyone but the owner, writing nothing", async () => {
    const before = await db.journalEntry.count();
    expect(await openFiscalYear(cashBook, { year: 2027 }, clock)).toEqual({ ok: false, error: "CASH_BOOK_NO_OPENING" });
    expect(await closePreview(cashBook, 2027, clock)).toMatchObject({ ok: true, value: { opening: null } });
    expect(await openFiscalYear(owner, { year: 2028 }, clock)).toEqual({ ok: false, error: "YEAR_NOT_BEGUN" });
    expect(await closePreview(owner, 2028, clock)).toMatchObject({ ok: true, value: { opening: null } });
    expect(await openFiscalYear(owner, { year: "2027" }, clock)).toEqual({ ok: false, error: "INVALID_INPUT" });
    for (const role of ["manager", "accountant", "worker"] as const) {
      expect(await openFiscalYear({ ...owner, role }, { year: 2027 }, clock), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(await closePreview({ ...owner, role: "accountant" }, 2027, clock)).toMatchObject({ ok: true, value: { opening: "provisional" } });
    expect(await db.journalEntry.count()).toBe(before);
  });

  it("after more 2026 entries, the year close posts the opening again as version 2, never two live openings, and the reversals once", async () => {
    expect(await sale("2026-12-20", 200_000n)).toMatchObject({ ok: true });
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 1 }); // the depreciation
    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 3 }); // à-nouveaux cancelled and version 2, the reversal

    expect(await versions()).toEqual([[1, true], [2, false]]);
    await expectOpeningEqualsClosing();
    expect(await db.journalEntry.count({ where: { sourceId: reversal() } })).toBe(1);
    expect(await closePreview(owner, 2027, clock)).toMatchObject({ ok: true, value: { opening: null } }); // 2026 closed: final

    expect(await openFiscalYear(owner, { year: 2027 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await versions()).toEqual([[1, true], [2, false]]);
  });

  it("after a reopen, the opening is provisional again and a click posts only what changed", async () => {
    expect(await reopenFiscalYear(owner, { year: 2026 })).toEqual({ ok: true, value: undefined });
    expect(await sale("2026-12-28", 100_000n)).toMatchObject({ ok: true }); // the last month is open again
    expect(await closePreview(owner, 2027, clock)).toMatchObject({ ok: true, value: { opening: "provisional" } });

    expect(await openFiscalYear(owner, { year: 2027 }, clock)).toEqual({ ok: true, value: 2 }); // version 2 cancelled, version 3; the reversal unchanged
    expect(await openFiscalYear(owner, { year: 2027 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await versions()).toEqual([[1, true], [2, true], [3, false]]);
    await expectOpeningEqualsClosing();
    expect(await db.journalEntry.count({ where: { sourceId: reversal() } })).toBe(1);
    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 });
  });
});
