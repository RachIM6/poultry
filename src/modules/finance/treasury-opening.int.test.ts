import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { addBankStatement, bankReconciliation, cashForecast, changeAccountingChoices, closeFiscalYear, matchBankLine, postManualEntry, runClose, treasuryOverview } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

const clock = fixedClock("2026-02-15T10:00:00Z");

// SPEC-finance FCX3, FN3, FN10, FC9: the first year's opening bank balance, typed by hand, on the bank account it names.
describe("an opening bank balance by manual entry, on /treasury, the reconciliation and the forecast", () => {
  let owner: TenantContext;
  const bank = uuidv7();
  const balanceOf = async (month: string) => {
    const t = await treasuryOverview(owner, month);
    if (!t.ok) throw new Error(t.error);
    return t.value.accounts.reduce((s, a) => s + a.balanceCentimes, 0n);
  };
  const forecastStart = async () => {
    const f = await cashForecast(owner, clock);
    if (!f.ok) throw new Error(f.error);
    return f.value.startCentimes;
  };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    owner = await tenant("+212600000031");
    const entity = (await listLegalEntities(owner))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 }, fixedClock("2024-12-01T10:00:00Z"))).toMatchObject({ ok: true });
    await db.treasuryAccount.create({ data: { id: bank, organizationId: owner.organizationId, kind: "bank", name: "Banque Populaire" } });
    const manual = (day: string, label: string, lines: object[]) => postManualEntry(owner, { id: uuidv7(), day, label, piece: null, lines }, clock);
    // 20 000,00 at the bank on the accountant's last balance sheet, then 150,00 of bank fees in June.
    expect(await manual("2025-01-01", "Soldes d’ouverture", [{ account: "5141", debit: "2000000", credit: "0", treasuryId: bank }, { account: "1111", debit: "0", credit: "2000000" }])).toEqual({ ok: true, value: undefined });
    expect(await manual("2025-06-10", "Frais bancaires", [{ account: "6147", debit: "15000", credit: "0" }, { account: "5141", debit: "0", credit: "15000", treasuryId: bank }])).toEqual({ ok: true, value: undefined });
  });

  it("shows on the bank account's balance and lets the reconciliation reach 0", async () => {
    expect(await balanceOf("2025-06")).toBe(1_985_000n);
    const added = await addBankStatement(owner, { treasuryId: bank, endDay: "2025-06-30", closingCentimes: "1985000" }, clock);
    if (!added.ok) throw new Error(added.error);
    const before = await bankReconciliation(owner, bank, added.value);
    if (!before.ok || !before.value.statement) throw new Error("no statement");
    expect(before.value.statement.lines.map((l) => [l.label, l.debitCentimes, l.creditCentimes])).toEqual([
      ["Soldes d’ouverture", 2_000_000n, 0n],
      ["Frais bancaires", 0n, 15_000n],
    ]);
    for (const l of before.value.statement.lines) expect(await matchBankLine(owner, { statementId: added.value, lineId: l.id, ticked: true })).toEqual({ ok: true, value: undefined });
    const after = await bankReconciliation(owner, bank, added.value);
    expect(after.ok && after.value.statement).toMatchObject({ bookCentimes: 1_985_000n, differenceCentimes: 0n, reconciled: true });
  });

  it("starts the forecast from the accounts' balances, before and after the year close (the à-nouveaux counted once)", async () => {
    expect(await forecastStart()).toBe(await balanceOf("2025-12"));
    expect(await runClose(owner, { year: 2025 }, clock)).toMatchObject({ ok: true });
    expect(await closeFiscalYear(owner, { year: 2025 }, clock)).toMatchObject({ ok: true });
    const opening = await db.journalLine.findMany({ where: { organizationId: owner.organizationId, account: "5141", entry: { sourceId: { startsWith: "opening:" } } } });
    expect(opening.map((l) => [l.debitCentimes, l.treasuryId])).toEqual([[1_985_000n, null]]); // carried forward on 5141, on no account
    expect(await balanceOf("2026-01")).toBe(1_985_000n);
    expect(await forecastStart()).toBe(1_985_000n);
    // A statement of the new year, nothing moved since: still reconciled, the à-nouveaux isn't a bank line.
    const january = await addBankStatement(owner, { treasuryId: bank, endDay: "2026-01-31", closingCentimes: "1985000" }, clock);
    if (!january.ok) throw new Error(january.error);
    const r = await bankReconciliation(owner, bank, january.value);
    expect(r.ok && r.value.statement).toMatchObject({ bookCentimes: 1_985_000n, differenceCentimes: 0n, reconciled: true, lines: [] });
  });
});
