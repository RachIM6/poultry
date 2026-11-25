import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, closeFiscalYear, closePreview, confirmLoan, createLoan, openFiscalYear, payLoanInstallment, runClose, setPeriodLocked } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant, twoTenants } from "@/test/tenant";

const clock = fixedClock("2028-06-15T10:00:00Z");
const OK = { ok: true, value: undefined };
// SPEC-finance §7.1 D: §7.1 B (100 000,00 disbursed on 15 Jan 2027, 6 quarters, 5,55 %) with its first due day on 15 Apr 2027.
const loanD = (treasuryId: string) => ({
  id: uuidv7(),
  lender: "Crédit Agricole du Maroc",
  treasuryId,
  principalCentimes: "10000000",
  disbursedOn: "2027-01-15",
  rate: 5_550,
  frequency: "quarterly",
  installments: 6,
  firstDueOn: "2027-04-15",
});
const linesOf = async (sourceId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceModule: "finance", sourceId } }, include: { entry: true }, orderBy: [{ entry: { createdAt: "asc" } }, { debitCentimes: "desc" }] })).map((l) => [
    l.entry.journal,
    l.entry.day.toISOString().slice(0, 10),
    l.account,
    l.debitCentimes,
    l.creditCentimes,
  ]);
/** Every line of an entity dated in 2027, as stored: a closed year must not move. */
const year2027 = (legalEntityId: string) =>
  db.journalLine.findMany({
    where: { entry: { legalEntityId, day: { gte: new Date("2027-01-01T00:00:00Z"), lte: new Date("2027-12-31T00:00:00Z") } } },
    select: { id: true, account: true, debitCentimes: true, creditCentimes: true, entry: { select: { id: true, sourceId: true, sourceVersion: true } } },
    orderBy: { id: "asc" },
  });

/** The loan of §7.1 D, confirmed, its 2027 installments paid on their due days. */
async function loanPaidTo2027(owner: TenantContext, bank: string) {
  const loan = loanD(bank);
  expect(await createLoan(owner, loan, clock)).toEqual(OK);
  expect(await confirmLoan(owner, { loanId: loan.id }, clock)).toEqual(OK);
  for (const [number, day] of [[1, "2027-04-15"], [2, "2027-07-15"], [3, "2027-10-15"]] as const) expect(await payLoanInstallment(owner, { loanId: loan.id, number, day }, clock)).toEqual(OK);
  return loan;
}

describe("accrued interest at the close (SPEC-finance FC2, FQ16: PCA pp. 78, 108)", () => {
  let owner: TenantContext, before: TenantContext, entity: string, beforeEntity: string;
  const [bank, beforeBank] = [uuidv7(), uuidv7()];

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [owner] = await twoTenants();
    before = await tenant("+212600000003", "Ferme C");
    entity = (await listLegalEntities(owner))[0].id;
    beforeEntity = (await listLegalEntities(before))[0].id;
    for (const [who, id] of [[owner, entity], [before, beforeEntity]] as const) {
      expect(await changeAccountingChoices(who, id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    }
    await db.treasuryAccount.createMany({
      data: [
        { id: bank, organizationId: owner.organizationId, kind: "bank", name: "Banque Populaire" },
        { id: beforeBank, organizationId: before.organizationId, kind: "bank", name: "CIH" },
      ],
    });
  });

  it("§7.1 D: the preview shows it, the close run posts D 63111 / C 4493 580,64 on 31 Dec 2027, once; the 2028 opening reverses it", async () => {
    await loanPaidTo2027(owner, bank);
    const preview = await closePreview(owner, 2027, clock);
    expect(preview.ok && preview.value.entries.find((e) => e.kind === "interest")).toEqual({
      kind: "interest",
      action: "post",
      lines: [
        { account: "63111", label: "Intérêts des emprunts", debit: 58_064n, credit: 0n },
        { account: "4493", label: "Intérêts courus et non échus à payer", debit: 0n, credit: 58_064n },
      ],
    });
    expect(await runClose(owner, { year: 2027 }, clock)).toEqual({ ok: true, value: 1 }); // nothing else to close this year
    expect(await runClose(owner, { year: 2027 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await linesOf(`close:interest:${entity}:2027`)).toEqual([
      ["OD", "2027-12-31", "63111", 58_064n, 0n],
      ["OD", "2027-12-31", "4493", 0n, 58_064n],
    ]);
    expect(await db.journalEntry.findFirstOrThrow({ where: { sourceId: `close:interest:${entity}:2027` } })).toMatchObject({ label: "Intérêts courus et non échus" });

    // FCX5: reversed on the next year's first day with the à-nouveaux; the installment of 15 Jan 2028 then books its whole interest.
    expect(await closeFiscalYear(owner, { year: 2027 }, clock)).toMatchObject({ ok: true });
    expect(await linesOf(`reversal:close:interest:${entity}:2027`)).toEqual([
      ["OD", "2028-01-01", "4493", 58_064n, 0n],
      ["OD", "2028-01-01", "63111", 0n, 58_064n],
    ]);
    const opening = await linesOf(`opening:${entity}:2028-01-01`);
    expect(opening.filter((l) => l[2] === "4493")).toEqual([["OD", "2028-01-01", "4493", 0n, 58_064n]]); // carried forward, then reversed
    const [loan] = await db.loan.findMany({ where: { organizationId: owner.organizationId } });
    expect(await payLoanInstallment(owner, { loanId: loan.id, number: 4, day: "2028-01-15" }, clock)).toEqual(OK);
    const interest2028 = await db.journalLine.findMany({ where: { account: "63111", entry: { legalEntityId: entity, day: { gte: new Date("2028-01-01T00:00:00Z") } } } });
    expect(interest2028.reduce((s, l) => s + l.debitCentimes - l.creditCentimes, 0n)).toBe(11_311n); // 693,75 − 580,64: only 2028's days
  });

  it("never touches a year closed before this rule: the run is refused, the year close posts nothing, its lines stay as they were", async () => {
    await loanPaidTo2027(before, beforeBank);
    // 2027 closed by the earlier rules (no accrued interest): every month locked and the year marked closed.
    for (let m = 1; m <= 12; m++) expect(await setPeriodLocked(before, beforeEntity, `2027-${String(m).padStart(2, "0")}`, true)).toEqual(OK);
    await db.fiscalYearClose.create({ data: { organizationId: before.organizationId, legalEntityId: beforeEntity, day: new Date("2027-12-31T00:00:00Z"), closedBy: before.userId, closedAt: new Date("2028-01-20T09:00:00Z") } });
    const closed = await year2027(beforeEntity);

    expect(await runClose(before, { year: 2027 }, clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await closeFiscalYear(before, { year: 2027 }, clock)).toEqual({ ok: false, error: "CLOSE_RUN_PENDING" });
    expect(await openFiscalYear(before, { year: 2028 }, clock)).toMatchObject({ ok: true }); // the opening reads 2027 as it stands
    expect(await year2027(beforeEntity)).toEqual(closed);
    expect(await db.journalLine.count({ where: { account: "4493", entry: { legalEntityId: beforeEntity } } })).toBe(0);
    expect(await db.journalEntry.count({ where: { sourceId: { contains: `close:interest:${beforeEntity}` } } })).toBe(0);
  });
});
