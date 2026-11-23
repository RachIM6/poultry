import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { Role, TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import {
  cashForecast,
  changeAccountingChoices,
  confirmLoan,
  createLoan,
  discardLoan,
  loanRegister,
  payLoanInstallment,
  readBooks,
  saveLoanSchedule,
  sendLoanReminders,
  setPeriodLocked,
} from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant, twoTenants } from "@/test/tenant";

const clock = fixedClock("2028-06-15T10:00:00Z");
// SPEC-finance §7.1 B: 100 000,00 disbursed on 15 Jan 2027, 6 quarters, 5,55 %, first due day 31 Mar 2027.
const loanB = (treasuryId: string, more: object = {}) => ({
  id: uuidv7(),
  lender: "Crédit Agricole du Maroc",
  treasuryId,
  principalCentimes: "10000000",
  disbursedOn: "2027-01-15",
  rate: 5_550,
  frequency: "quarterly",
  installments: 6,
  firstDueOn: "2027-03-31",
  ...more,
});
const OK = { ok: true, value: undefined };
const linesOf = async (sourceId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceModule: "finance", sourceId } }, include: { entry: true }, orderBy: [{ entry: { createdAt: "asc" } }, { debitCentimes: "desc" }, { account: "asc" }] })).map((l) => [
    l.entry.journal,
    l.entry.day.toISOString().slice(0, 10),
    l.account,
    l.debitCentimes,
    l.creditCentimes,
    l.treasuryId,
  ]);
const entriesOf = (id: string) => db.journalEntry.count({ where: { sourceModule: "finance", sourceId: { startsWith: `loan:${id}:` } } });
const rowsOf = async (loanId: string) =>
  (await db.loanInstallment.findMany({ where: { loanId }, orderBy: { number: "asc" } })).map((r) => [r.number, r.dueOn.toISOString().slice(0, 10), r.capitalCentimes, r.interestCentimes]);
const edit = (rows: (string | number | bigint)[][], changes: Record<number, [bigint, bigint]>) =>
  rows.map(([number, , capital, interest]) => {
    const [dc, di] = changes[number as number] ?? [0n, 0n];
    return { number, capitalCentimes: String((capital as bigint) + dc), interestCentimes: String((interest as bigint) + di) };
  });

describe("loans (SPEC-finance FC2, T105)", () => {
  let owner: TenantContext, cashBook: TenantContext, other: TenantContext;
  const [bank, box, cashBookBank, otherBank] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const b = loanB(bank); // the first test's loan, paid in the second

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [owner, cashBook] = await twoTenants(); // an individual farmer keeps the receipts-and-expenses book (FN1)
    other = await tenant("+212600000003", "Ferme C");
    expect(await changeAccountingChoices(owner, (await listLegalEntities(owner))[0].id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    // Another organisation, without the PCA (FN2: the CGNC accounts).
    expect(await changeAccountingChoices(other, (await listLegalEntities(other))[0].id, { books: "ledger", pcaOverlay: false, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    await db.treasuryAccount.createMany({
      data: [
        { id: bank, organizationId: owner.organizationId, kind: "bank", name: "Banque Populaire" },
        { id: box, organizationId: owner.organizationId, kind: "cash", name: "Caisse ferme" },
        { id: cashBookBank, organizationId: cashBook.organizationId, kind: "bank", name: "CIH" },
        { id: otherBank, organizationId: other.organizationId, kind: "bank", name: "Attijariwafa" },
      ],
    });
  });

  it("§7.1 B: the draft schedule to the centime; once confirmed, the disbursement D 5141 / C 1481 on its day, once", async () => {
    const l = b;
    expect(await createLoan(owner, l, clock)).toEqual(OK);
    expect(await createLoan(owner, l, clock)).toEqual(OK); // the same form again
    expect(await db.loan.count({ where: { organizationId: owner.organizationId } })).toBe(1);
    expect(await rowsOf(l.id)).toEqual([
      [1, "2027-03-31", 1_666_667n, 138_750n],
      [2, "2027-06-30", 1_666_667n, 115_625n],
      [3, "2027-09-30", 1_666_667n, 92_500n],
      [4, "2027-12-31", 1_666_667n, 69_375n],
      [5, "2028-03-31", 1_666_667n, 46_250n],
      [6, "2028-06-30", 1_666_665n, 23_125n],
    ]);
    expect(await entriesOf(l.id)).toBe(0); // a draft posts nothing

    expect(await confirmLoan(owner, { loanId: l.id }, clock)).toEqual(OK);
    expect(await confirmLoan(owner, { loanId: l.id }, clock)).toEqual(OK); // again: nothing more
    expect(await linesOf(`loan:${l.id}:disbursement`)).toEqual([
      ["BQ", "2027-01-15", "5141", 10_000_000n, 0n, bank],
      ["BQ", "2027-01-15", "1481", 0n, 10_000_000n, null],
    ]);
    expect(await entriesOf(l.id)).toBe(1);
    expect(await db.auditEvent.count({ where: { entity: "Loan", entityId: l.id } })).toBe(2); // create, confirm

    const register = await loanRegister(owner);
    if (!register.ok) throw new Error(register.error);
    const [view] = register.value.loans;
    expect(view).toMatchObject({ lender: "Crédit Agricole du Maroc", bank: "Banque Populaire", confirmed: true, owed: 10_000_000n });
    expect(view.rows.map((r) => r.outstandingBefore)).toEqual([10_000_000n, 8_333_333n, 6_666_666n, 4_999_999n, 3_333_332n, 1_666_665n]);
    expect(view.rows.reduce((s, r) => s + r.interest, 0n)).toBe(485_625n); // 4 856,25
  });

  it("marking an installment paid twice posts once, on the day entered, on or after its due day; a confirmed schedule can't be edited", async () => {
    const loanId = b.id;
    const manager = { ...owner, role: "manager" as Role };
    expect(await saveLoanSchedule(owner, { loanId, rows: edit(await rowsOf(loanId), { 1: [1n, 0n], 6: [-1n, 0n] }) })).toEqual({ ok: false, error: "LOAN_CONFIRMED" });
    expect(await discardLoan(owner, { loanId })).toEqual({ ok: false, error: "LOAN_CONFIRMED" });
    expect((await rowsOf(loanId))[0]).toEqual([1, "2027-03-31", 1_666_667n, 138_750n]);

    expect(await payLoanInstallment(owner, { loanId, number: 1, day: "2027-03-30" }, clock)).toEqual({ ok: false, error: "BEFORE_DUE_DAY" });
    expect(await payLoanInstallment(owner, { loanId, number: 1, day: "2028-06-17" }, clock)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(await payLoanInstallment(owner, { loanId, number: 7, day: "2027-03-31" }, clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await payLoanInstallment(owner, { loanId, number: 1, day: "2027-04-02" }, clock)).toEqual(OK); // debited two days late
    expect(await payLoanInstallment(manager, { loanId, number: 1, day: "2027-03-31" }, clock)).toEqual(OK); // marked again
    expect(await linesOf(`loan:${loanId}:installment:1`)).toEqual([
      ["BQ", "2027-04-02", "1481", 1_666_667n, 0n, null],
      ["BQ", "2027-04-02", "63111", 138_750n, 0n, null],
      ["BQ", "2027-04-02", "5141", 0n, 1_805_417n, bank],
    ]);
    expect(await entriesOf(loanId)).toBe(2); // the disbursement and installment 1
    expect((await db.loanInstallment.findFirstOrThrow({ where: { loanId, number: 1 } })).paidOn?.toISOString().slice(0, 10)).toBe("2027-04-02");

    // The manager marks the next one (FCX1); a locked month refuses it, nothing posted, and it stays unpaid.
    expect(await setPeriodLocked(owner, (await listLegalEntities(owner))[0].id, "2027-06", true)).toEqual(OK);
    expect(await payLoanInstallment(manager, { loanId, number: 2, day: "2027-06-30" }, clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await entriesOf(loanId)).toBe(2);
    expect((await db.loanInstallment.findFirstOrThrow({ where: { loanId, number: 2 } })).paidOn).toBeNull();
    expect(await payLoanInstallment(manager, { loanId, number: 2, day: "2027-07-01" }, clock)).toEqual(OK); // the day the bank debited it
    expect(await setPeriodLocked(owner, (await listLegalEntities(owner))[0].id, "2027-06", false)).toEqual(OK);

    const register = await loanRegister(owner);
    if (!register.ok) throw new Error(register.error);
    expect(register.value.loans[0].owed).toBe(10_000_000n - 2n * 1_666_667n);
    expect(register.value.loans[0].rows.map((r) => r.paidOn)).toEqual(["2027-04-02", "2027-07-01", null, null, null, null]);
  });

  it("refuses a confirmation whose capital doesn't add up to the principal; rows adjusted to the bank's table confirm", async () => {
    const l = loanB(bank, { lender: "BMCE Bank" });
    expect(await createLoan(owner, l, clock)).toEqual(OK);
    const generated = await rowsOf(l.id);
    expect(await saveLoanSchedule(owner, { loanId: l.id, rows: edit(generated, { 1: [1n, 0n] }) })).toEqual(OK); // a draft may not add up yet
    expect(await confirmLoan(owner, { loanId: l.id }, clock)).toEqual({ ok: false, error: "CAPITAL_NOT_PRINCIPAL" });
    expect(await entriesOf(l.id)).toBe(0);
    expect((await db.loan.findUniqueOrThrow({ where: { id: l.id } })).confirmedAt).toBeNull();

    // Every row, by number, or nothing.
    expect(await saveLoanSchedule(owner, { loanId: l.id, rows: edit(generated, {}).slice(1) })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveLoanSchedule(owner, { loanId: l.id, rows: edit(generated, { 1: [1n, 0n], 6: [-1n, 0n], 2: [0n, 1n] }) })).toEqual(OK);
    expect(await confirmLoan(owner, { loanId: l.id }, clock)).toEqual(OK);
    expect((await rowsOf(l.id)).map((r) => [r[2], r[3]])).toEqual([
      [1_666_668n, 138_750n],
      [1_666_667n, 115_626n],
      [1_666_667n, 92_500n],
      [1_666_667n, 69_375n],
      [1_666_667n, 46_250n],
      [1_666_664n, 23_125n],
    ]);

    // A draft typed wrong is thrown away; a first due day on the disbursement day is refused.
    const wrong = loanB(bank, { principalCentimes: "1000000" });
    expect(await createLoan(owner, wrong, clock)).toEqual(OK);
    expect(await discardLoan(owner, { loanId: wrong.id })).toEqual(OK);
    expect(await db.loanInstallment.count({ where: { loanId: wrong.id } })).toBe(0);
    expect(await createLoan(owner, loanB(bank, { firstDueOn: "2027-01-15" }), clock)).toEqual({ ok: false, error: "FIRST_DUE_BEFORE_DISBURSEMENT" });
    expect(await createLoan(owner, loanB(bank, { disbursedOn: "2028-06-17" }), clock)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(await createLoan(owner, loanB(box), clock)).toEqual({ ok: false, error: "INVALID_INPUT" }); // a cash box isn't a bank account
  });

  it("is the owner's to write; a manager marks installments paid; the accountant reads; workers and other organisations get nothing", async () => {
    const [manager, accountant, worker] = (["manager", "accountant", "worker"] as const).map((role) => ({ ...owner, role }));
    const l = loanB(bank, { lender: "Banque Populaire" });
    for (const who of [manager, accountant, worker]) {
      expect(await createLoan(who, l, clock), who.role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(await createLoan(owner, l, clock)).toEqual(OK);
    const rows = edit(await rowsOf(l.id), {});
    for (const who of [manager, accountant, worker]) {
      expect(await saveLoanSchedule(who, { loanId: l.id, rows }), who.role).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await confirmLoan(who, { loanId: l.id }, clock), who.role).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await discardLoan(who, { loanId: l.id }), who.role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(await payLoanInstallment(manager, { loanId: l.id, number: 1, day: "2027-03-31" }, clock)).toEqual({ ok: false, error: "LOAN_NOT_CONFIRMED" });
    expect(await confirmLoan(owner, { loanId: l.id }, clock)).toEqual(OK);
    for (const who of [accountant, worker]) {
      expect(await payLoanInstallment(who, { loanId: l.id, number: 1, day: "2027-03-31" }, clock), who.role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    const read = await loanRegister(accountant);
    expect(read.ok && read.value.loans.map((x) => x.lender)).toContain("Banque Populaire");
    expect(await loanRegister(worker)).toEqual({ ok: false, error: "FORBIDDEN" });

    // Another organisation sees none of it and can't touch it, nor pay into this one's bank account.
    expect(await payLoanInstallment(other, { loanId: l.id, number: 1, day: "2027-03-31" }, clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await saveLoanSchedule(other, { loanId: l.id, rows })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await confirmLoan(other, { loanId: l.id }, clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await createLoan(other, loanB(bank), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await createLoan(other, { ...loanB(otherBank), id: l.id }, clock)).toEqual({ ok: false, error: "ALREADY_EXISTS" });
    const theirs = await loanRegister(other);
    expect(theirs.ok && theirs.value.loans).toEqual([]);
  });

  it("lands on 5141, 1481 and 63111 with the PCA off too", async () => {
    const l = loanB(otherBank);
    expect(await createLoan(other, l, clock)).toEqual(OK);
    expect(await confirmLoan(other, { loanId: l.id }, clock)).toEqual(OK);
    expect(await payLoanInstallment(other, { loanId: l.id, number: 1, day: "2027-03-31" }, clock)).toEqual(OK);
    expect((await linesOf(`loan:${l.id}:disbursement`)).map((x) => x[2])).toEqual(["5141", "1481"]);
    expect((await linesOf(`loan:${l.id}:installment:1`)).map((x) => [x[2], x[3], x[4]])).toEqual([["1481", 1_666_667n, 0n], ["63111", 138_750n, 0n], ["5141", 0n, 1_805_417n]]);
  });

  it("works for a cash_book entity: the disbursement and the installment show in its cash book", async () => {
    const l = loanB(cashBookBank);
    expect(await createLoan(cashBook, l, clock)).toEqual(OK);
    expect(await confirmLoan(cashBook, { loanId: l.id }, clock)).toEqual(OK);
    expect(await payLoanInstallment(cashBook, { loanId: l.id, number: 1, day: "2027-03-31" }, clock)).toEqual(OK);
    const january = await readBooks(cashBook, "2027-01");
    const march = await readBooks(cashBook, "2027-03");
    if (!january.ok || !march.ok) throw new Error("books");
    expect(march.value.books).toBe("cash_book");
    expect(january.value.cashBook.rows.map((r) => [r.day, r.label, r.account, r.counterAccounts, r.receipt, r.expense])).toEqual([
      ["2027-01-15", "Déblocage d’emprunt : Crédit Agricole du Maroc", "5141", ["1481"], 10_000_000n, 0n],
    ]);
    expect(march.value.cashBook.rows.map((r) => [r.day, r.label, r.account, r.counterAccounts, r.receipt, r.expense])).toEqual([
      ["2027-03-31", "Échéance d’emprunt n° 1 : Crédit Agricole du Maroc", "5141", ["1481", "63111"], 0n, 1_805_417n],
    ]);
  });

  it("posts no disbursement for a loan in the opening balance; its installments post as usual", async () => {
    // Taken before Dawra: the capital still owed comes with the opening entry (FCX3).
    const l = loanB(bank, { lender: "Ancien prêt", principalCentimes: "5000000", disbursedOn: null, installments: 4, firstDueOn: "2027-02-28" });
    expect(await createLoan(owner, l, clock)).toEqual(OK);
    expect(await confirmLoan(owner, { loanId: l.id }, clock)).toEqual(OK);
    expect(await linesOf(`loan:${l.id}:disbursement`)).toEqual([]);
    expect(await payLoanInstallment(owner, { loanId: l.id, number: 1, day: "2027-02-28" }, clock)).toEqual(OK);
    expect((await linesOf(`loan:${l.id}:installment:1`)).map((x) => [x[2], x[3], x[4]])).toEqual([["1481", 1_250_000n, 0n], ["63111", 69_375n, 0n], ["5141", 0n, 1_319_375n]]);
  });

  it("counts the unpaid installments of confirmed loans in the /treasury cash schedule", async () => {
    const d = await tenant("+212600000004", "Ferme Échéancier");
    const dBank = uuidv7();
    await db.treasuryAccount.create({ data: { id: dBank, organizationId: d.organizationId, kind: "bank", name: "BMCI" } });
    const confirmed = loanB(dBank);
    for (const l of [confirmed, loanB(dBank, { lender: "Brouillon" })]) expect(await createLoan(d, l, clock)).toEqual(OK);
    expect(await confirmLoan(d, { loanId: confirmed.id }, clock)).toEqual(OK);
    const weeks = async (now: string) => {
      const f = await cashForecast(d, fixedClock(now));
      if (!f.ok) throw new Error(f.error);
      return f.value.weeks.map((w) => [w.from, w.outCentimes]);
    };
    // 100 000,00 in the bank; installment 1 (18 054,17) falls in the second week, the draft's never.
    expect(await weeks("2027-03-20T10:00:00Z")).toEqual([["2027-03-20", 0n], ["2027-03-27", 1_805_417n], ["2027-04-03", 0n], ["2027-04-10", 0n]]);
    // Overdue and unpaid: counted in the first week; once paid, no more.
    expect((await weeks("2027-04-05T10:00:00Z"))[0]).toEqual(["2027-04-05", 1_805_417n]);
    expect(await payLoanInstallment(d, { loanId: confirmed.id, number: 1, day: "2027-04-02" }, clock)).toEqual(OK);
    expect((await weeks("2027-04-05T10:00:00Z"))[0]).toEqual(["2027-04-05", 0n]);
  });
});

describe("loan reminders (FC2: a money notification, once, on the due day)", () => {
  let owner: TenantContext;
  const users: Partial<Record<Role, string>> = {};

  beforeAll(async () => {
    owner = await tenant("+212600000010", "Ferme Rappels");
    users.owner = owner.userId;
    for (const [role, phone] of [["manager", "+212600000011"], ["worker", "+212600000012"], ["accountant", "+212600000013"]] as const) {
      const user = await db.user.create({ data: { phoneNumber: phone, name: phone, email: `${phone.slice(1)}@phone.invalid` } });
      await db.membership.create({ data: { organizationId: owner.organizationId, userId: user.id, role } });
      users[role] = user.id;
    }
  });

  it("announces each installment once on its due day to owners and managers, never to workers or the accountant; not a draft's, not a paid one", async () => {
    const bank = uuidv7();
    await db.treasuryAccount.create({ data: { id: bank, organizationId: owner.organizationId, kind: "bank", name: "Banque Populaire" } });
    const l = loanB(bank, { disbursedOn: "2029-04-10", firstDueOn: "2029-05-31", installments: 2 }); // due 31 May and 31 Aug 2029
    const draft = loanB(bank, { lender: "Brouillon", disbursedOn: "2029-04-10", firstDueOn: "2029-05-31" });
    const at = (iso: string) => fixedClock(iso);
    for (const x of [l, draft]) expect(await createLoan(owner, x, at("2029-04-20T10:00:00Z"))).toEqual(OK);
    expect(await confirmLoan(owner, { loanId: l.id }, at("2029-04-20T10:00:00Z"))).toEqual(OK);

    expect(await sendLoanReminders(at("2029-05-30T12:00:00Z"))).toBe(0); // the day before
    expect(await sendLoanReminders(at("2029-05-31T01:00:00Z"))).toBe(1); // the start of the farm day
    expect(await sendLoanReminders(at("2029-05-31T09:00:00Z"))).toBe(0); // once
    const sent = await db.notification.findMany({ where: { organizationId: owner.organizationId, templateKey: "loanDue" } });
    expect(sent.map((n) => n.userId).sort()).toEqual([users.owner, users.manager].sort());
    expect(sent[0].params).toMatchObject({ lender: "Crédit Agricole du Maroc", number: "1" });
    expect((sent[0].params as { amount: string }).amount).toMatch(/^51.387,50\sDH$/); // 50 000,00 + 1 387,50

    // Paid on its due day before the scheduler came by: no reminder.
    expect(await payLoanInstallment(owner, { loanId: l.id, number: 2, day: "2029-08-31" }, at("2029-08-31T08:00:00Z"))).toEqual(OK);
    expect(await sendLoanReminders(at("2029-08-31T09:00:00Z"))).toBe(0);
    expect(await db.notification.count({ where: { organizationId: owner.organizationId, templateKey: "loanDue" } })).toBe(2);
  });
});
