import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { attachManualEntryReceipt, changeAccountingChoices, exportBooks, postManualEntry, readBooks, setPeriodLocked } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";
import { unzip } from "@/test/unzip";

const clock = fixedClock("2026-06-15T10:00:00Z");
const line = (account: string, debit: string, credit: string) => ({ account, debit, credit });
// The first year's opening balances, from the accountant's last balance sheet: a truck and the bank against the capital.
const opening = [line("2340", "8000000", "0"), line("5141", "2000000", "0"), line("1111", "0", "10000000")];
const entry = (more: object = {}) => ({ id: uuidv7(), day: "2026-01-01", label: "Soldes d’ouverture", piece: "Bilan 2025", lines: opening, ...more });

describe("manual entries (SPEC-finance FCX3, FN3, T101)", () => {
  let owner: TenantContext, cashBook: TenantContext, entity: string;
  const posted = (id: string) => db.journalEntry.count({ where: { id } });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [owner, cashBook] = await twoTenants();
    entity = (await listLegalEntities(owner))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
  });

  it("posts a balanced entry on any leaf account once (OD, source finance:<id>), audited", async () => {
    const e = entry();
    expect(await postManualEntry(owner, e, clock)).toEqual({ ok: true, value: undefined });
    expect(await postManualEntry(owner, e, clock)).toEqual({ ok: true, value: undefined }); // a retry of the same form
    const rows = await db.journalEntry.findMany({ where: { organizationId: owner.organizationId, sourceModule: "finance", sourceId: e.id }, include: { lines: true } });
    expect(rows.map((r) => [r.id, r.journal, r.day.toISOString().slice(0, 10), r.sourceVersion, r.lines.length])).toEqual([[e.id, "OD", "2026-01-01", 1, 3]]);
    expect(await db.manualEntry.findUnique({ where: { id: e.id } })).toMatchObject({ organizationId: owner.organizationId, piece: "Bilan 2025", receiptFileId: null });
    expect(await db.auditEvent.count({ where: { entity: "JournalEntry", entityId: e.id, action: "create" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entity: "ManualEntry", entityId: e.id, action: "create" } })).toBe(1);
  });

  it("refuses unbalanced, one-line and parent-account entries (FN4)", async () => {
    const refused = [
      [[line("5141", "10000", "0"), line("1111", "0", "9999")], "UNBALANCED"],
      [[line("5141", "10000", "0")], "TOO_FEW_LINES"],
      [[line("2321", "10000", "0"), line("1111", "0", "10000")], "UNKNOWN_ACCOUNT"], // 2321 Bâtiments has sub-accounts
      [[line("5999", "10000", "0"), line("1111", "0", "10000")], "UNKNOWN_ACCOUNT"], // no such account
      [[line("5141", "10000", "10000"), line("1111", "0", "0")], "ONE_SIDE_PER_LINE"],
    ] as const;
    for (const [lines, error] of refused) {
      const e = entry({ lines });
      expect(await postManualEntry(owner, e, clock), error).toEqual({ ok: false, error });
      expect(await posted(e.id)).toBe(0);
      expect(await db.manualEntry.count({ where: { id: e.id } })).toBe(0);
    }
    expect(await postManualEntry(owner, entry({ label: " " }), clock)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await postManualEntry(owner, entry({ day: "2026-06-17" }), clock)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
  });

  it("is the owner's: manager, accountant and worker are refused; the accountant reads the entry on /books", async () => {
    for (const role of ["manager", "accountant", "worker"] as const) {
      const e = entry();
      expect(await postManualEntry({ ...owner, role }, e, clock), role).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await posted(e.id)).toBe(0);
    }
    const books = await readBooks({ ...owner, role: "accountant" }, "2026-01");
    if (!books.ok) throw new Error(books.error);
    const od = books.value.journals?.find((j) => j.journal === "OD")?.entries;
    expect(od?.map((e) => [e.label, e.piece, e.lines.length])).toEqual([["Soldes d’ouverture", "Bilan 2025", 3]]);
    expect(books.value.trialBalance?.rows.find((r) => r.account === "2340")?.balance).toBe(8_000_000n);
    expect(books.value.postingAccounts).toBeUndefined(); // the form is the owner's

    const own = await readBooks(owner, "2026-01");
    if (!own.ok) throw new Error(own.error);
    const numbers = new Set(own.value.postingAccounts?.map((a) => a.number));
    expect(["2340", "5141", "1111", "612122"].every((n) => numbers.has(n))).toBe(true);
    expect(["2321", "6124", "6"].some((n) => numbers.has(n))).toBe(false); // accounts with sub-accounts aren't offered
  });

  it("refuses an entry in a locked month with the reason, and doesn't move it", async () => {
    expect(await setPeriodLocked(owner, entity, "2026-02", true)).toEqual({ ok: true, value: undefined });
    const e = entry({ day: "2026-02-10" });
    expect(await postManualEntry(owner, e, clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await posted(e.id)).toBe(0); // not in March either
    expect(await db.manualEntry.count({ where: { id: e.id } })).toBe(0);
  });

  it("refuses a cash_book entity: its opening counter-account waits for FQ11", async () => {
    const e = entry({ lines: [line("5161", "50000", "0"), line("1111", "0", "50000")] });
    expect(await postManualEntry(cashBook, e, clock)).toEqual({ ok: false, error: "CASH_BOOK_NO_MANUAL_ENTRY" });
    expect(await posted(e.id)).toBe(0);
  });

  it("attaches a receipt once, to the organisation's own manual entry, for the owner (ADR-011)", async () => {
    const e = entry({ day: "2026-03-05", label: "Intérêts courus", piece: null, lines: [line("6311", "12000", "0"), line("4493", "0", "12000")] });
    expect(await postManualEntry(owner, e, clock)).toEqual({ ok: true, value: undefined });
    const file = uuidv7();
    expect(await attachManualEntryReceipt({ ...owner, role: "manager" }, e.id, file)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await attachManualEntryReceipt(cashBook, e.id, file)).toEqual({ ok: false, error: "NOT_FOUND" }); // another organisation
    expect(await attachManualEntryReceipt(owner, e.id, file)).toEqual({ ok: true, value: undefined });
    expect(await attachManualEntryReceipt(owner, e.id, uuidv7())).toEqual({ ok: false, error: "FILE_ALREADY_ATTACHED" });
    const books = await readBooks(owner, "2026-03");
    if (!books.ok) throw new Error(books.error);
    expect(books.value.journals?.find((j) => j.journal === "OD")?.entries.map((x) => [x.piece, x.receipt])).toEqual([[null, file]]);
  });

  it("answers two submits of the same form at once as a retry: one entry, no error", async () => {
    const e = entry({ day: "2026-05-04", label: "Frais de dossier", piece: null, lines: [line("6311", "1000", "0"), line("4493", "0", "1000")] });
    expect(await Promise.all([postManualEntry(owner, e, clock), postManualEntry(owner, e, clock)])).toEqual([
      { ok: true, value: undefined },
      { ok: true, value: undefined },
    ]);
    expect(await posted(e.id)).toBe(1);
    expect(await db.manualEntry.count({ where: { id: e.id } })).toBe(1);
  });

  it("puts a manual entry's typed piece in the export's Pièce column, its id when it has none (FN18)", async () => {
    const lines = [line("6311", "5000", "0"), line("4493", "0", "5000")];
    const typed = entry({ day: "2026-04-02", label: "Régularisation", piece: "FAC-2026-117", lines });
    const untyped = entry({ day: "2026-04-03", label: "Intérêts courus", piece: null, lines });
    for (const e of [typed, untyped]) expect(await postManualEntry(owner, e, clock)).toEqual({ ok: true, value: undefined });
    const exported = await exportBooks(owner, "2026-04");
    if (!exported.ok) throw new Error(exported.error);
    const csv = unzip(exported.value.zip).get("ecritures-2026-04.csv")!;
    expect(csv).toMatch(/\r\n02\/04\/2026;OD;FAC-2026-117;6311;/);
    expect(csv).toMatch(/\r\n02\/04\/2026;OD;FAC-2026-117;4493;/);
    expect(csv).not.toContain(typed.id);
    expect(csv).toContain(`\r\n03/04/2026;OD;${untyped.id};6311;`);
  });
});
