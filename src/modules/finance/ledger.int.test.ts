import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, openFiscalYear, postEntry, reverseEntry, setPeriodLocked, type EntryRow, type Line } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

const d = (s: string) => s as FarmDay;
const line = (account: string, debit: bigint, credit: bigint): Line => ({ account, debit, credit });
const feedPurchase = [line("612122", 450_000n, 0n), line("4411", 0n, 450_000n)]; // 4 500,00 DH of feed on credit

describe("ledger core (SPEC-finance FN3–FN5, T29)", () => {
  let a: TenantContext, b: TenantContext, entityA: string, entityB: string;
  const post = (ctx: TenantContext, e: Partial<EntryRow> & { day: FarmDay }) =>
    db.$transaction((tx) =>
      postEntry(tx, ctx, { id: uuidv7(), legalEntityId: entityA, journal: "AC", label: "Aliment", reversesId: null, lines: feedPurchase, ...e }),
    );

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [a, b] = await twoTenants();
    [entityA, entityB] = await Promise.all([a, b].map(async (ctx) => (await listLegalEntities(ctx))[0].id));
  });

  it("posts a balanced entry and audits it; refuses what FN4 forbids", async () => {
    const id = uuidv7();
    expect(await post(a, { id, day: d("2025-03-10") })).toEqual({ ok: true, value: undefined });
    expect(await db.journalLine.count({ where: { entryId: id } })).toBe(2);
    expect(await db.auditEvent.count({ where: { entity: "JournalEntry", entityId: id, action: "create" } })).toBe(1);

    expect(await post(a, { day: d("2025-03-10"), lines: [line("612122", 1n, 0n), line("4411", 0n, 2n)] })).toEqual({ ok: false, error: "UNBALANCED" });
    expect(await post(a, { day: d("2025-03-10"), lines: [line("9999", 1n, 0n), line("4411", 0n, 1n)] })).toEqual({ ok: false, error: "UNKNOWN_ACCOUNT" });
    expect(await post(a, { id, day: d("2025-03-10") })).toEqual({ ok: false, error: "ALREADY_EXISTS" });
  });

  it("refuses an unbalanced entry written straight in SQL, at commit (deferred trigger)", async () => {
    const id = uuidv7();
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "JournalEntry" (id, "organizationId", "legalEntityId", journal, day, label, "createdBy")
          VALUES (${id}::uuid, ${a.organizationId}::uuid, ${entityA}::uuid, 'OD', '2025-03-11', 'x', ${a.userId}::uuid)`;
        await tx.$executeRaw`INSERT INTO "JournalLine" ("organizationId", "entryId", account, "debitCentimes") VALUES (${a.organizationId}::uuid, ${id}::uuid, '5141', 100)`;
        await tx.$executeRaw`INSERT INTO "JournalLine" ("organizationId", "entryId", account, "creditCentimes") VALUES (${a.organizationId}::uuid, ${id}::uuid, '4411', 99)`;
      }),
    ).rejects.toThrow(/not balanced/);
    expect(await db.journalEntry.count({ where: { id } })).toBe(0);
  });

  it("never updates or deletes a posted entry; a reversal swaps the sides and links to it, once", async () => {
    const id = uuidv7();
    await post(a, { id, day: d("2025-04-02") });
    await expect(db.$executeRaw`UPDATE "JournalLine" SET "debitCentimes" = 1 WHERE "entryId" = ${id}::uuid AND "debitCentimes" > 0`).rejects.toThrow(/immutable/);
    await expect(db.$executeRaw`DELETE FROM "JournalEntry" WHERE id = ${id}::uuid`).rejects.toThrow(/immutable/);

    const reversed = await reverseEntry(a, id, d("2025-04-20"), "Annulation");
    if (!reversed.ok) throw new Error(reversed.error);
    const rev = await db.journalEntry.findUniqueOrThrow({ where: { id: reversed.value }, include: { lines: { orderBy: { account: "asc" } } } });
    expect(rev.reversesId).toBe(id);
    expect(rev.lines.map((l) => [l.account, l.debitCentimes, l.creditCentimes])).toEqual([["4411", 450_000n, 0n], ["612122", 0n, 450_000n]]);
    expect(await reverseEntry(a, id, d("2025-04-21"), "Encore")).toEqual({ ok: false, error: "ALREADY_REVERSED" });
  });

  it("locks a period for the owner only: no entry lands in it, a correction goes to the first open month", async () => {
    const id = uuidv7();
    await post(a, { id, day: d("2025-05-15") });
    const manager = { ...a, role: "manager" as const };
    expect(await setPeriodLocked(manager, entityA, "2025-05", true)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await setPeriodLocked(a, entityA, "2025-05", true)).toEqual({ ok: true, value: undefined });
    expect(await setPeriodLocked(a, entityA, "2025-06", true)).toEqual({ ok: true, value: undefined });
    expect(await db.auditEvent.count({ where: { entity: "LockedPeriod", action: "lock" } })).toBe(2);

    expect(await post(manager, { day: d("2025-05-20") })).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    const reversed = await reverseEntry(manager, id, d("2025-05-31"), "Correction");
    if (!reversed.ok) throw new Error(reversed.error);
    expect((await db.journalEntry.findUniqueOrThrow({ where: { id: reversed.value } })).day.toISOString().slice(0, 10)).toBe("2025-07-01");

    await setPeriodLocked(a, entityA, "2025-05", false);
    expect(await post(manager, { day: d("2025-05-20") })).toMatchObject({ ok: true });
  });

  it("opens a fiscal year with the à-nouveaux entry: classes 1–5 carried forward, the result on 1191, once", async () => {
    // Entity B, year 2025: the feed bought on credit (4 500,00), 3 000,00 of it paid by bank, birds sold 8 000,00 cash.
    const inB = (lines: Line[], day: string) =>
      db.$transaction((tx) => postEntry(tx, b, { id: uuidv7(), legalEntityId: entityB, journal: "OD", day: d(day), label: "x", reversesId: null, lines }));
    await inB(feedPurchase, "2025-02-01");
    await inB([line("4411", 300_000n, 0n), line("5141", 0n, 300_000n)], "2025-03-01");
    await inB([line("5161", 800_000n, 0n), line("712121", 0n, 800_000n)], "2025-09-01");

    const opened = await openFiscalYear(b, entityB, d("2026-01-15"));
    if (!opened.ok || !opened.value) throw new Error(String(opened.ok || opened.error));
    const an = await db.journalEntry.findUniqueOrThrow({ where: { id: opened.value }, include: { lines: { orderBy: { account: "asc" } } } });
    expect(an.day.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(an.lines.map((l) => [l.account, l.debitCentimes, l.creditCentimes])).toEqual([
      ["1191", 0n, 350_000n], // 8 000,00 sold − 4 500,00 of feed
      ["4411", 0n, 150_000n],
      ["5141", 0n, 300_000n],
      ["5161", 800_000n, 0n],
    ]);
    expect(await openFiscalYear(b, entityB, d("2026-03-01"))).toEqual({ ok: true, value: opened.value === null ? null : expect.any(String) });
    expect(await db.journalEntry.count({ where: { legalEntityId: entityB, label: "À-nouveaux" } })).toBe(1);
  });

  it("changes the accounting choices only while the fiscal year has no entry", async () => {
    const today = fixedClock("2027-02-01T10:00:00Z"); // entity A has no 2027 entry yet
    const choices = { books: "ledger" as const, pcaOverlay: false, fiscalYearStartMonth: 1 };
    expect(await changeAccountingChoices({ ...a, role: "manager" }, entityA, choices, today)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await changeAccountingChoices(a, entityA, choices, today)).toEqual({ ok: true, value: undefined });
    expect((await listLegalEntities(a))[0].accountingProfile).toMatchObject({ books: "ledger", overlays: [] });

    // PCA now off: the PCA feed account is refused, its CGNC account (6121) is not.
    expect(await post(a, { day: d("2027-02-02") })).toEqual({ ok: false, error: "UNKNOWN_ACCOUNT" });
    expect(await post(a, { day: d("2027-02-02"), lines: [line("6121", 100n, 0n), line("4411", 0n, 100n)] })).toMatchObject({ ok: true });
    expect(await changeAccountingChoices(a, entityA, { ...choices, pcaOverlay: true }, today)).toEqual({ ok: false, error: "FISCAL_YEAR_HAS_ENTRIES" });
  });

  it("keeps each organisation's books apart, and workers out", async () => {
    expect(await post(b, { day: d("2025-08-01") })).toEqual({ ok: false, error: "NOT_FOUND" }); // A's entity
    const [entryOfA] = await db.journalEntry.findMany({ where: { legalEntityId: entityA }, take: 1 });
    expect(await reverseEntry(b, entryOfA.id, d("2025-08-01"), "x")).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await setPeriodLocked(b, entityA, "2025-08", true)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await post({ ...a, role: "worker" }, { day: d("2025-08-01") })).toEqual({ ok: false, error: "FORBIDDEN" });
  });
});
