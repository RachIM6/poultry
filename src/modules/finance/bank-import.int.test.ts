import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { addBankStatement, bankReconciliation, IMPORT_MAX_BYTES, importBankFile, matchBankLine } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

// SPEC-finance FC9, T117: a statement file imported onto a bank account, idempotent, its lines handed to T111's ticks.
// The fixtures are synthetic (fixtures/bank/README.md).
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-10T08:00:00+01:00" });
const applied = async (ctx: TenantContext, ...ms: ReturnType<typeof m>[]) => expect((await push(ctx, ms, registry)).results.map((r) => r.status)).toEqual(ms.map(() => "applied"));
const bytes = (name: string) => new Uint8Array(readFileSync(`src/modules/finance/fixtures/bank/${name}`));
const clock = fixedClock("2026-03-20T12:00:00Z");
const csvMapping = { separator: ";", skipLines: 1, dateColumn: 1, dateFormat: "DD/MM/YYYY", labelColumn: 2, amountColumn: null, debitColumn: 3, creditColumn: 4, decimalComma: true };

describe("bank statement import (SPEC-finance FC9, T117)", () => {
  let a: TenantContext, b: TenantContext;
  const box = uuidv7();
  const bank = uuidv7();
  const other = uuidv7(); // a second bank account, for the CSV
  const ids: Record<string, string> = {};
  const mt940 = (input: Record<string, unknown> = {}) => ({ treasuryId: bank, format: "mt940", fileName: "releve.sta", bytes: bytes("synthetic-one-statement.sta"), csv: null, dryRun: false, ...input });
  const read = async (ctx: TenantContext, account: string) => {
    const r = await bankReconciliation(ctx, account);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [a, b] = await twoTenants();
    await applied(a, m("finance.createTreasuryAccount", { id: box, kind: "cash", name: "Caisse" }), m("finance.createTreasuryAccount", { id: bank, kind: "bank", name: "Banque A" }), m("finance.createTreasuryAccount", { id: other, kind: "bank", name: "Banque B" }));
    // T111's two weeks, booked through the existing forms; the statement file has the first four.
    const expense = (key: string, day: string, category: string, amountCentimes: string) => {
      ids[key] = uuidv7();
      return m("finance.recordExpense", { id: ids[key], day, category, amountCentimes, paidFrom: "bank", treasuryId: bank, note: null });
    };
    const transfer = (key: string, day: string, amountCentimes: string, fromId: string, toId: string) => {
      ids[key] = uuidv7();
      return m("finance.recordTransfer", { id: ids[key], day, amountCentimes, fromId, toId });
    };
    await applied(
      a,
      transfer("deposit", "2026-03-02", "5000000", box, bank),
      expense("power", "2026-03-05", "electricity", "120000"),
      expense("water", "2026-03-09", "water", "30000"),
      transfer("withdrawal", "2026-03-12", "500000", bank, box),
      expense("insurance", "2026-03-13", "insurance", "80000"), // not at the bank by the 14th
    );
    for (const k of Object.keys(ids)) ids[k] = (await db.journalLine.findFirstOrThrow({ where: { account: "5141", entry: { sourceId: ids[k] } } })).id;
  });

  it("previews without saving anything", async () => {
    const r = await importBankFile(a, mt940({ dryRun: true }), clock);
    expect(r).toMatchObject({ ok: true, value: { dryRun: true, statements: [{ id: null, endDay: "2026-03-14", openingCentimes: "0", closingCentimes: "4350000", lineCount: 4, added: 4 }] } });
    expect(await db.bankStatement.count({ where: { organizationId: a.organizationId } })).toBe(0);
    expect(await db.bankStatementLine.count()).toBe(0);
  });

  it("imports an MT940 statement, pairs its lines with the books, and ticking them brings the difference to 0", async () => {
    const r = await importBankFile(a, mt940(), clock);
    if (!r.ok) throw new Error(r.error);
    const [s] = r.value.statements;
    expect(s).toMatchObject({ endDay: "2026-03-14", closingCentimes: "4350000", lineCount: 4, added: 4 });

    const before = (await read(a, bank)).statement!;
    expect(before).toMatchObject({ id: s.id, closingCentimes: 4_350_000n, bookCentimes: 4_270_000n, differenceCentimes: 4_350_000n, reconciled: false });
    expect(before.imported.map((l) => [l.day, l.amountCentimes, l.lineId, l.ticked])).toEqual([
      ["2026-03-02", 5_000_000n, ids.deposit, false],
      ["2026-03-05", -120_000n, ids.power, false],
      ["2026-03-09", -30_000n, ids.water, false],
      ["2026-03-12", -500_000n, ids.withdrawal, false],
    ]);
    expect(before.imported[1].label).toBe("PRELEVEMENT ELECTRICITE FACTURE SYNTHETIQUE 0001");

    // The handoff: the owner ticks each proposed line through T111's matching, unchanged.
    for (const l of before.imported) expect(await matchBankLine(a, { statementId: s.id!, lineId: l.lineId!, ticked: true })).toEqual({ ok: true, value: undefined });
    const after = (await read(a, bank)).statement!;
    expect(after).toMatchObject({ tickedCentimes: 4_350_000n, differenceCentimes: 0n, reconciled: true });
    expect(after.imported.every((l) => l.ticked)).toBe(true);
    expect(after.lines.filter((l) => !l.ticked).map((l) => l.id)).toEqual([ids.insurance]);

    const events = await db.auditEvent.findMany({ where: { organizationId: a.organizationId, entity: "BankStatement", action: "import" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityId: s.id, userId: a.userId, after: { treasuryId: bank, format: "mt940", fileName: "releve.sta", endDay: "2026-03-14", closingCentimes: "4350000", created: true, lines: 4 } });
  });

  it("is idempotent: the same file again adds no statement, no line and no audit event, and its preview says so", async () => {
    const counts = async () => [await db.bankStatement.count({ where: { treasuryId: bank } }), await db.bankStatementLine.count(), await db.auditEvent.count({ where: { entity: "BankStatement" } })];
    const before = await counts();
    expect(await importBankFile(a, mt940(), clock)).toMatchObject({ ok: true, value: { statements: [{ added: 0, lineCount: 4 }] } });
    expect(await importBankFile(a, mt940({ dryRun: true }), clock)).toMatchObject({ ok: true, value: { statements: [{ added: 0 }] } });
    // The same statement in LF instead of CRLF reads the same lines: still nothing new.
    const lf = new TextEncoder().encode(new TextDecoder().decode(bytes("synthetic-one-statement.sta")).replaceAll("\r\n", "\n"));
    expect(await importBankFile(a, mt940({ bytes: lf }), clock)).toMatchObject({ ok: true, value: { statements: [{ added: 0 }] } });
    expect(await counts()).toEqual(before);
  });

  it("refuses a file that contradicts a statement already there, and saves nothing of it", async () => {
    const lines = await db.bankStatementLine.count();
    // Another closing balance for 14 March.
    const changed = new TextEncoder().encode(new TextDecoder().decode(bytes("synthetic-one-statement.sta")).replace(":61:2603090309D300,", ":61:2603090309D310,").replace("MAD43500,00", "MAD43490,00"));
    expect(await importBankFile(a, mt940({ bytes: changed }), clock)).toEqual({ ok: false, error: "IMPORT_CONFLICT" });
    // Same balance, other lines.
    const swapped = new TextEncoder().encode(new TextDecoder().decode(bytes("synthetic-one-statement.sta")).replace(":61:2603090309D300,", ":61:2603090309D310,").replace(":61:2603120312D5000,00", ":61:2603120312D4990,00"));
    expect(await importBankFile(a, mt940({ bytes: swapped }), clock)).toEqual({ ok: false, error: "IMPORT_CONFLICT" });
    expect(await db.bankStatementLine.count()).toBe(lines);
  });

  it("imports a CSV with the owner's mapping onto a statement entered by hand, once", async () => {
    // The owner had typed the statement of 14 March on the second account; the CSV's lines join it.
    const manual = await addBankStatement(a, { treasuryId: other, endDay: "2026-03-14", closingCentimes: "4350000" }, clock);
    if (!manual.ok) throw new Error(manual.error);
    const input = { treasuryId: other, format: "csv", fileName: "export.CSV", bytes: bytes("synthetic-debit-credit.csv"), csv: { mapping: csvMapping, endDay: "2026-03-14", closingCentimes: "4350000" }, dryRun: false };
    expect(await importBankFile(a, input, clock)).toMatchObject({ ok: true, value: { statements: [{ id: manual.value, added: 4 }] } });
    const s = (await read(a, other)).statement!;
    expect(s.imported.map((l) => [l.label, l.amountCentimes, l.lineId])).toEqual([
      ["VERSEMENT ESPECES; SYNTHETIQUE", 5_000_000n, null], // nothing booked on this account: all missing from the books
      ["PRELEVEMENT ELECTRICITE", -120_000n, null],
      ["PRELEVEMENT EAU", -30_000n, null],
      ['RETRAIT "ESPECES"', -500_000n, null], // Windows-1252 decoded, quotes undone
    ]);
    expect(await importBankFile(a, input, clock)).toMatchObject({ ok: true, value: { statements: [{ added: 0 }] } });
    expect(await importBankFile(a, { ...input, csv: { ...input.csv, closingCentimes: "1" } }, clock)).toEqual({ ok: false, error: "IMPORT_CONFLICT" });
    expect(await importBankFile(a, { ...input, csv: { ...input.csv, mapping: { ...csvMapping, amountColumn: 3 } } }, clock)).toEqual({ ok: false, error: "INVALID_INPUT" }); // both kinds of amount
  });

  it("checks the file: parse errors with their line, size, name, binary content, future days", async () => {
    const text = new TextDecoder().decode(bytes("synthetic-one-statement.sta"));
    expect(await importBankFile(a, mt940({ bytes: new TextEncoder().encode(text.replace("MAD43500,00", "MAD43500,01")) }), clock)).toEqual({ ok: false, error: "IMPORT_BALANCE", line: 15 });
    expect(await importBankFile(a, mt940({ bytes: new Uint8Array(IMPORT_MAX_BYTES + 1) }), clock)).toEqual({ ok: false, error: "IMPORT_TOO_LARGE" });
    expect(await importBankFile(a, mt940({ fileName: "releve.exe" }), clock)).toEqual({ ok: false, error: "IMPORT_FILE_TYPE" });
    expect(await importBankFile(a, mt940({ bytes: new Uint8Array([0x3a, 0x32, 0x30, 0x3a, 0x00]) }), clock)).toEqual({ ok: false, error: "IMPORT_FILE_TYPE" });
    expect(await importBankFile(a, mt940(), fixedClock("2026-03-13T12:00:00Z"))).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(await importBankFile(a, mt940({ format: "csv" }), clock)).toEqual({ ok: false, error: "INVALID_INPUT" }); // a CSV needs its mapping
  });

  it("lets the owner and a manager import; refuses the accountant, workers, a cash box and other organisations", async () => {
    const manager = { ...a, role: "manager" as const };
    expect(await importBankFile(manager, mt940(), clock)).toMatchObject({ ok: true, value: { statements: [{ added: 0 }] } });
    expect(await importBankFile({ ...a, role: "accountant" as const }, mt940(), clock)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await importBankFile({ ...a, role: "worker" as const }, mt940(), clock)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await importBankFile(a, mt940({ treasuryId: box }), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await importBankFile(b, mt940(), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await db.bankStatementLine.count({ where: { organizationId: b.organizationId } })).toBe(0);
  });
});
