import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, postEntry, postManualEntry, readBooks, reopenFiscalYear, reverseEntry, setPeriodLocked } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

// SPEC-finance FN5, FCX3, FCX6 (2026-11-23): the owner locks a month of the books on /books, and cancels a manual entry.
const clock = fixedClock("2026-06-15T10:00:00Z");
const line = (account: string, debit: string, credit: string) => ({ account, debit, credit });
const interest = [line("63111", "12000", "0"), line("4493", "0", "12000")]; // 120,00 DH of accrued interest
const entry = (day: string, more: object = {}) => ({ id: uuidv7(), day, label: "Intérêts courus", piece: null, lines: interest, ...more });
const OK = { ok: true, value: undefined };

describe("month lock and manual entry reversal (SPEC-finance FN5, FCX3)", () => {
  let owner: TenantContext, other: TenantContext, entity: string;
  const dayOf = async (id: string) => (await db.journalEntry.findUniqueOrThrow({ where: { id } })).day.toISOString().slice(0, 10);
  const lockedMonths = async () => (await db.lockedPeriod.findMany({ where: { legalEntityId: entity }, orderBy: { month: "asc" } })).map((l) => l.month);

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [owner, other] = await twoTenants();
    entity = (await listLegalEntities(owner))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 }, clock)).toMatchObject({ ok: true });
  });

  it("locks a month for the owner only, audited: it refuses entries until unlocked; /books shows it", async () => {
    for (const role of ["manager", "accountant", "worker"] as const) {
      expect(await setPeriodLocked({ ...owner, role }, entity, "2026-03", true), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(await setPeriodLocked(other, entity, "2026-03", true)).toEqual({ ok: false, error: "NOT_FOUND" }); // another organisation's
    expect(await setPeriodLocked(owner, entity, "2026-03", true)).toEqual(OK);
    expect(await db.auditEvent.findFirst({ where: { entity: "LockedPeriod", entityId: entity, action: "lock" } })).toMatchObject({ userId: owner.userId, after: { month: "2026-03" } });

    const refused = entry("2026-03-10");
    expect(await postManualEntry(owner, refused, clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await db.journalEntry.count({ where: { id: refused.id } })).toBe(0);
    const books = await readBooks({ ...owner, role: "accountant" }, "2026-03");
    expect(books).toMatchObject({ ok: true, value: { lockedMonths: ["2026-03"] } });

    expect(await setPeriodLocked({ ...owner, role: "manager" }, entity, "2026-03", false)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await setPeriodLocked(owner, entity, "2026-03", false)).toEqual(OK);
    expect(await db.auditEvent.count({ where: { entity: "LockedPeriod", entityId: entity, action: "unlock" } })).toBe(1);
    expect(await postManualEntry(owner, refused, clock)).toEqual(OK);
  });

  it("refuses unlocking a month of a closed fiscal year: the year's reopen (FCX6) is the way back", async () => {
    // The 2025 year, closed: every month locked and the close recorded, as closeFiscalYear leaves them.
    for (let m = 1; m <= 12; m++) expect(await setPeriodLocked(owner, entity, `2025-${String(m).padStart(2, "0")}`, true)).toEqual(OK);
    await db.fiscalYearClose.create({ data: { organizationId: owner.organizationId, legalEntityId: entity, day: new Date("2025-12-31T00:00:00Z"), closedBy: owner.userId, closedAt: new Date("2026-03-01T10:00:00Z") } });

    expect(await setPeriodLocked(owner, entity, "2025-06", false)).toEqual({ ok: false, error: "FISCAL_YEAR_CLOSED" });
    expect(await setPeriodLocked(owner, entity, "2025-12", false)).toEqual({ ok: false, error: "FISCAL_YEAR_CLOSED" });
    expect(await setPeriodLocked(owner, entity, "2025-06", true)).toEqual(OK); // locking it again changes nothing
    expect((await lockedMonths()).filter((m) => m.startsWith("2025"))).toHaveLength(12);

    // Reopened: its last month is unlocked by the reopen, the others by the owner, month by month.
    expect(await reopenFiscalYear(owner, { year: 2025 })).toEqual(OK);
    expect(await setPeriodLocked(owner, entity, "2025-06", false)).toEqual(OK);
    expect((await lockedMonths()).filter((m) => m.startsWith("2025"))).toHaveLength(10);
  });

  it("cancels a manual entry once, for the owner only: the same lines, sides swapped, on its day; then a new one", async () => {
    const wrong = entry("2026-04-10", { label: "Intérêts (erreur)" });
    expect(await postManualEntry(owner, wrong, clock)).toEqual(OK);
    for (const role of ["manager", "accountant", "worker"] as const) {
      expect(await reverseEntry({ ...owner, role }, wrong.id), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(await reverseEntry(other, wrong.id)).toEqual({ ok: false, error: "NOT_FOUND" }); // another organisation's

    const reversed = await reverseEntry(owner, wrong.id);
    if (!reversed.ok) throw new Error(reversed.error);
    const rev = await db.journalEntry.findUniqueOrThrow({ where: { id: reversed.value }, include: { lines: { orderBy: { account: "asc" } } } });
    expect([rev.journal, rev.day.toISOString().slice(0, 10), rev.label, rev.reversesId]).toEqual(["OD", "2026-04-10", "Annulation : Intérêts (erreur)", wrong.id]);
    expect(rev.lines.map((l) => [l.account, l.debitCentimes, l.creditCentimes])).toEqual([["4493", 12_000n, 0n], ["63111", 0n, 12_000n]]);
    expect(await db.auditEvent.count({ where: { entity: "JournalEntry", entityId: rev.id, action: "create" } })).toBe(1);
    expect(await reverseEntry(owner, wrong.id)).toEqual({ ok: false, error: "ALREADY_REVERSED" });

    // Two cancels at once: one reversal.
    const twice = entry("2026-04-11");
    expect(await postManualEntry(owner, twice, clock)).toEqual(OK);
    const both = await Promise.all([reverseEntry(owner, twice.id), reverseEntry(owner, twice.id)]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.find((r) => !r.ok)).toEqual({ ok: false, error: "ALREADY_REVERSED" });
    expect(await db.journalEntry.count({ where: { reversesId: twice.id } })).toBe(1);

    const right = entry("2026-04-10", { label: "Intérêts courus avril" });
    expect(await postManualEntry(owner, right, clock)).toEqual(OK);
    const books = await readBooks(owner, "2026-04");
    if (!books.ok) throw new Error(books.error);
    const od = books.value.journals?.find((j) => j.journal === "OD")?.entries ?? [];
    expect(od.map((e) => [e.label, e.reversed])).toEqual([
      ["Intérêts (erreur)", true],
      ["Annulation : Intérêts (erreur)", undefined], // a reversal is not a manual entry: no button
      ["Intérêts courus avril", false],
      ["Intérêts courus", true],
      ["Annulation : Intérêts courus", undefined],
    ]);
    expect(books.value.trialBalance?.rows.find((r) => r.account === "63111")?.balance).toBe(24_000n); // March's entry and the right one
  });

  it("reverses an entry of a locked month in the first open month after it", async () => {
    const may = entry("2026-05-05");
    expect(await postManualEntry(owner, may, clock)).toEqual(OK);
    expect(await setPeriodLocked(owner, entity, "2026-05", true)).toEqual(OK);
    const reversed = await reverseEntry(owner, may.id);
    if (!reversed.ok) throw new Error(reversed.error);
    expect(await dayOf(reversed.value)).toBe("2026-06-01");
    expect(await dayOf(may.id)).toBe("2026-05-05"); // never moved nor changed
  });

  it("refuses an entry that is not a manual one: its own module's flow reverses it (FN7)", async () => {
    const id = uuidv7();
    const posted = await db.$transaction((tx) =>
      postEntry(tx, owner, { id, legalEntityId: entity, journal: "OD", day: "2026-06-02" as FarmDay, label: "Intérêts", reversesId: null, lines: [{ account: "63111", debit: 12_000n, credit: 0n }, { account: "4493", debit: 0n, credit: 12_000n }], source: { module: "loans", id: uuidv7(), version: 1 } }),
    );
    expect(posted).toEqual(OK);
    expect(await reverseEntry(owner, id)).toEqual({ ok: false, error: "NOT_MANUAL_ENTRY" });
    const reversal = await db.journalEntry.findFirstOrThrow({ where: { legalEntityId: entity, label: "Annulation : Intérêts (erreur)" } });
    expect(await reverseEntry(owner, reversal.id)).toEqual({ ok: false, error: "NOT_MANUAL_ENTRY" }); // a reversal is never reversed
    expect(await reverseEntry(owner, "not-an-id")).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await db.journalEntry.count({ where: { reversesId: id } })).toBe(0);
  });
});
