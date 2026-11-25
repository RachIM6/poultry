import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { pull, push } from "@/lib/sync/server";
import type { Role, TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import * as finance from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";
import { unzip } from "@/test/unzip";

/**
 * SPEC-finance §8 (M2 #4, M6 #5), FX2, FCX1 and SPEC-m5 PA5: every finance function that reads or writes for a user,
 * run as each role of the organisation and as the owner of another one. Workers and vets get nothing; the accountant
 * reads and every write is refused; `finance.manage` is the owner's; another organisation gets NOT_FOUND or FORBIDDEN,
 * never a row of ours, and changes nothing of ours. An allowed read must succeed; an allowed write must pass the role
 * check (its own business refusals are its own tests'). A new export of `finance/index.ts` fails the last test until
 * it is added to the table or to SKIPPED.
 */

// Not in the table: no user behind them, or no data in or out.
const SKIPPED: Record<string, string> = {
  chartOf: "pure: builds a chart from rows it is given",
  postingAccount: "pure",
  rollUp: "pure",
  breakEvenPrice: "pure",
  budgetOf: "pure",
  budgetCash: "pure",
  plainTiming: "pure",
  batchOf: "pure",
  postPending: "posting job: runs as the server after a push, whoever pushed (§9)",
  postAllPending: "posting job: the scheduler's, no user",
  catchUpBooks: "posting trigger before a read: returns nothing, and the reads it precedes are in the table",
  sendLoanReminders: "the scheduler's, no user (FC2)",
};

const clock = fixedClock("2026-11-20T10:00:00Z");
const ROLES = ["worker", "vet", "accountant", "manager", "owner"] as const satisfies readonly Role[];
// Who passes each gate (src/lib/permissions.ts, checked against the spec): money.read, finance.record, finance.manage.
const GATES = { read: ["owner", "manager", "accountant"], record: ["owner", "manager"], manage: ["owner"] } as const satisfies Record<string, readonly Role[]>;
type Gate = keyof typeof GATES;

type Outcome = { ok: true; value?: unknown } | { ok: false; error: string };
type Seed = Record<"entity" | "box" | "bank" | "farm" | "house" | "batch" | "expense" | "asset" | "loan" | "manual" | "statement" | "bankLine" | "budget", string>;
type Row = {
  name: string; // the export's name first: the guard reads it
  gate: Gate;
  kind: "read" | "write";
  ours?: true; // passes one of our ids: another organisation must get NOT_FOUND or FORBIDDEN
  run: (ctx: TenantContext, s: Seed) => Promise<Outcome>;
};

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-01T08:00:00+01:00" });
const pushed = async (ctx: TenantContext, mutation: ReturnType<typeof m>): Promise<Outcome> => {
  const [r] = (await push(ctx, [mutation], finance.financeSync)).results;
  return r.status === "applied" ? { ok: true } : { ok: false, error: r.messageKey.replace("errors.", "") };
};
const asset = (more: object) => ({ id: uuidv7(), label: "Groupe électrogène", category: "equipment", acquiredOn: "2026-01-10", inServiceOn: "2026-01-10", amountCentimes: "4735000", lifeMonths: 84, ...more });
const loan = (treasuryId: string) => ({ id: uuidv7(), lender: "Crédit Agricole du Maroc", treasuryId, principalCentimes: "10000000", disbursedOn: "2026-01-15", rate: 5_550, frequency: "quarterly", installments: 6, firstDueOn: "2026-03-31" });
const line = (account: string, debit: string, credit: string, treasuryId: string | null = null) => ({ account, debit, credit, treasuryId });
const budget = () => ({ id: uuidv7(), name: "Bande d’avril", basedOn: null, chicks: "1000", chickPriceCentimes: "550", feedGrams: "3000000", feedPricePerKgCentimes: "460", otherCostCentimes: "0", plannedGrams: "2000000", salePricePerKgCentimes: "1400" });
const pay = (more: object) => ({ id: uuidv7(), day: "2026-04-10", amountCentimes: "10000", paidWith: "cash", ...more });

// Reads first, so the writes the owner and the manager get through change nothing they read; the year's close last.
const ROWS: Row[] = [
  // money.read: owner, manager, accountant (SPEC-m5 PA5, FCX1)
  { name: "treasuryOverview", gate: "read", kind: "read", run: (c) => finance.treasuryOverview(c, "2026-03") },
  { name: "cashForecast", gate: "read", kind: "read", run: (c) => finance.cashForecast(c, clock) },
  { name: "bankReconciliation", gate: "read", kind: "read", run: (c, s) => finance.bankReconciliation(c, s.bank, s.statement) },
  { name: "batchResults", gate: "read", kind: "read", run: (c) => finance.batchResults(c) },
  { name: "batchResultDtos", gate: "read", kind: "read", run: (c) => finance.batchResultDtos(c) },
  { name: "budgetBases", gate: "read", kind: "read", run: (c) => finance.budgetBases(c) },
  { name: "budgetPaymentDelays", gate: "read", kind: "read", run: (c) => finance.budgetPaymentDelays(c) },
  { name: "budgetBatches", gate: "read", kind: "read", run: (c) => finance.budgetBatches(c) },
  { name: "listBudgets", gate: "read", kind: "read", run: (c) => finance.listBudgets(c) },
  { name: "readBooks", gate: "read", kind: "read", run: (c) => finance.readBooks(c, "2026-01") },
  { name: "exportBooks", gate: "read", kind: "read", run: (c) => finance.exportBooks(c, "2026-01") },
  { name: "exportFec", gate: "read", kind: "read", run: (c) => finance.exportFec(c, "2026-01") },
  { name: "officialStatements", gate: "read", kind: "read", run: (c) => finance.officialStatements(c, 2026, clock) },
  { name: "thresholdTracker", gate: "read", kind: "read", run: (c) => finance.thresholdTracker(c, clock) },
  { name: "yearEndCount", gate: "read", kind: "read", run: (c) => finance.yearEndCount(c, 2026, clock) },
  { name: "closePreview", gate: "read", kind: "read", run: (c) => finance.closePreview(c, 2026, clock) },
  { name: "assetRegister", gate: "read", kind: "read", run: (c) => finance.assetRegister(c, clock) },
  { name: "subsidyRegister", gate: "read", kind: "read", run: (c) => finance.subsidyRegister(c) },
  { name: "loanRegister", gate: "read", kind: "read", run: (c) => finance.loanRegister(c) },
  {
    name: "financeSync pull", // FX2: workers' and vets' phones receive no treasury account, expense or transfer
    gate: "read",
    kind: "read",
    run: async (c) => {
      const { changes } = await pull(c, 0, finance.financeSync);
      return changes.length > 0 ? { ok: true, value: changes } : { ok: false, error: "FORBIDDEN" };
    },
  },
  // The lists to pay and the chart: decided default, to review (SPEC-m5 §9), the accountant reads them
  { name: "placementsToPay", gate: "read", kind: "read", run: (c) => finance.placementsToPay(c) },
  { name: "creditExpensesToPay", gate: "read", kind: "read", run: (c) => finance.creditExpensesToPay(c) },
  { name: "chartView", gate: "read", kind: "read", run: (c) => finance.chartView(c) },
  { name: "accountingSettings", gate: "read", kind: "read", run: (c) => finance.accountingSettings(c, clock) }, // the profile; only the owner changes it
  // The owner's settings (finance.manage, FX2: profile, overrides)
  {
    name: "accountingChoicesOpen", // a boolean, false when refused: asked for a year without entries, the owner alone gets true
    gate: "manage",
    kind: "read",
    run: async (c) => {
      const [entity] = await listLegalEntities(c);
      return (await finance.accountingChoicesOpen(c, entity, fixedClock("2030-06-15T10:00:00Z"))) ? { ok: true } : { ok: false, error: "FORBIDDEN" };
    },
  },
  { name: "postingOverrides", gate: "manage", kind: "read", run: (c) => finance.postingOverrides(c) },
  { name: "associateAccount", gate: "manage", kind: "read", run: (c) => finance.associateAccount(c) },

  // finance.record: owner, manager (FX2; FCX1: installments, the count, bank matching)
  {
    name: "postEntry",
    gate: "record",
    kind: "write",
    ours: true,
    run: (c, s) =>
      db.$transaction((tx) =>
        finance.postEntry(tx, c, { id: uuidv7(), legalEntityId: s.entity, journal: "OD", day: "2026-02-01" as FarmDay, label: "Écriture", reversesId: null, lines: [{ account: "2340", debit: 100n, credit: 0n }, { account: "1111", debit: 0n, credit: 100n }] }),
      ),
  },
  { name: "financeSync push finance.createTreasuryAccount", gate: "record", kind: "write", run: (c) => pushed(c, m("finance.createTreasuryAccount", { id: uuidv7(), kind: "cash", name: "Caisse 2" })) },
  {
    name: "financeSync push finance.recordExpense",
    gate: "record",
    kind: "write",
    ours: true,
    run: (c, s) => pushed(c, m("finance.recordExpense", { id: uuidv7(), day: "2026-02-10", category: "electricity", amountCentimes: "10000", paidFrom: "cash", treasuryId: s.box, note: null })),
  },
  {
    name: "financeSync push finance.recordTransfer",
    gate: "record",
    kind: "write",
    ours: true,
    run: (c, s) => pushed(c, m("finance.recordTransfer", { id: uuidv7(), day: "2026-02-11", amountCentimes: "10000", fromId: s.box, toId: s.bank })),
  },
  { name: "attachExpenseReceipt", gate: "record", kind: "write", ours: true, run: (c, s) => finance.attachExpenseReceipt(c, s.expense, uuidv7()) },
  { name: "payPlacement", gate: "record", kind: "write", ours: true, run: (c, s) => finance.payPlacement(c, pay({ batchId: s.batch, treasuryId: s.box }), clock) },
  {
    name: "financeSync push finance.correctExpense",
    gate: "record",
    kind: "write",
    ours: true,
    run: (c, s) => pushed(c, m("finance.correctExpense", { id: s.expense, day: "2026-03-02", category: "electricity", amountCentimes: "60000", paidFrom: "credit", treasuryId: null, note: null })),
  },
  { name: "payCreditExpense", gate: "record", kind: "write", ours: true, run: (c, s) => finance.payCreditExpense(c, pay({ expenseId: s.expense, treasuryId: s.box }), clock) },
  { name: "financeSync push finance.cancelExpense", gate: "record", kind: "write", ours: true, run: (c, s) => pushed(c, m("finance.cancelExpense", { expenseId: s.expense })) },
  { name: "addBankStatement", gate: "record", kind: "write", ours: true, run: (c, s) => finance.addBankStatement(c, { treasuryId: s.bank, endDay: "2026-04-30", closingCentimes: "0" }, clock) },
  { name: "matchBankLine", gate: "record", kind: "write", ours: true, run: (c, s) => finance.matchBankLine(c, { statementId: s.statement, lineId: s.bankLine, ticked: true }) },
  {
    name: "importBankFile",
    gate: "record",
    kind: "write",
    ours: true,
    run: (c, s) =>
      finance.importBankFile(c, { treasuryId: s.bank, format: "mt940", fileName: "releve.sta", bytes: new Uint8Array(readFileSync("src/modules/finance/fixtures/bank/synthetic-one-statement.sta")), csv: null, dryRun: true }, clock),
  },
  { name: "saveBudget", gate: "record", kind: "write", run: (c) => finance.saveBudget(c, budget()) },
  { name: "saveYearEndCount", gate: "record", kind: "write", run: (c) => finance.saveYearEndCount(c, { year: 2026, counts: {} }) },
  { name: "setDefaultTreasuryAccount", gate: "record", kind: "write", ours: true, run: (c, s) => finance.setDefaultTreasuryAccount(c, s.bank) }, // §9 "Default cash box and bank account"
  { name: "payLoanInstallment", gate: "record", kind: "write", ours: true, run: (c, s) => finance.payLoanInstallment(c, { loanId: s.loan, number: 1, day: "2026-03-31" }, clock) },

  // finance.manage: the owner (FX2: periods, profile, overrides; FCX1: registers, manual entries, the close)
  { name: "changeAccountingChoices", gate: "manage", kind: "write", ours: true, run: (c, s) => finance.changeAccountingChoices(c, s.entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 }, clock) },
  { name: "setPeriodLocked", gate: "manage", kind: "write", ours: true, run: (c, s) => finance.setPeriodLocked(c, s.entity, "2026-05", false) },
  {
    name: "reopenBatchBooks via the registry's flock.reopenBatch", // SPEC B6 "Reopening": chained there, behind finance.manage
    gate: "manage",
    kind: "write",
    ours: true,
    run: async (c, s) => {
      const [r] = (await push(c, [m("flock.reopenBatch", { batchId: s.batch, reason: "Vente oubliée" })], registry)).results;
      return r.status === "applied" ? { ok: true } : { ok: false, error: r.messageKey.replace("errors.", "") };
    },
  },
  { name: "setPostingOverride", gate: "manage", kind: "write", run: (c) => finance.setPostingOverride(c, { ruleAccount: "612512", account: null }) },
  {
    name: "recordAssociateMovement",
    gate: "manage",
    kind: "write",
    ours: true,
    run: (c, s) => finance.recordAssociateMovement(c, { id: uuidv7(), day: "2026-04-01", direction: "contribution", amountCentimes: "10000", treasuryId: s.box }, clock),
  },
  {
    name: "postManualEntry",
    gate: "manage",
    kind: "write",
    ours: true,
    run: (c, s) => finance.postManualEntry(c, { id: uuidv7(), day: "2026-04-02", label: "OD", lines: [line("5141", "10000", "0", s.bank), line("1111", "0", "10000")] }, clock),
  },
  { name: "attachManualEntryReceipt", gate: "manage", kind: "write", ours: true, run: (c, s) => finance.attachManualEntryReceipt(c, s.manual, uuidv7()) },
  { name: "reverseEntry", gate: "manage", kind: "write", ours: true, run: (c, s) => finance.reverseEntry(c, s.manual) },
  { name: "createFixedAsset", gate: "manage", kind: "write", ours: true, run: (c, s) => finance.createFixedAsset(c, asset({ farmId: s.farm, houseId: s.house, paidWith: "cash", treasuryId: s.box }), clock) },
  { name: "updateFixedAsset", gate: "manage", kind: "write", ours: true, run: (c, s) => finance.updateFixedAsset(c, { assetId: s.asset, lifeMonths: 60, residualCentimes: "0" }) },
  { name: "payFixedAsset", gate: "manage", kind: "write", ours: true, run: (c, s) => finance.payFixedAsset(c, pay({ assetId: s.asset, treasuryId: s.box }), clock) },
  { name: "attachFixedAssetReceipt", gate: "manage", kind: "write", ours: true, run: (c, s) => finance.attachFixedAssetReceipt(c, s.asset, uuidv7()) },
  {
    name: "createSubsidy",
    gate: "manage",
    kind: "write",
    ours: true,
    run: (c, s) => finance.createSubsidy(c, { id: uuidv7(), label: "Aide", grantor: "FDA", amountCentimes: "100000", receivedOn: "2026-04-03", treasuryId: s.bank, assetIds: [s.asset] }, clock),
  },
  { name: "disposeFixedAsset", gate: "manage", kind: "write", ours: true, run: (c, s) => finance.disposeFixedAsset(c, { assetId: s.asset, day: "2026-05-02", priceCentimes: "0", receivedIn: "cash", treasuryId: null }, clock) },
  { name: "createLoan", gate: "manage", kind: "write", ours: true, run: (c, s) => finance.createLoan(c, loan(s.bank), clock) },
  { name: "saveLoanSchedule", gate: "manage", kind: "write", ours: true, run: (c, s) => finance.saveLoanSchedule(c, { loanId: s.loan, rows: [{ number: 1, capitalCentimes: "1", interestCentimes: "0" }] }) },
  { name: "confirmLoan", gate: "manage", kind: "write", ours: true, run: (c, s) => finance.confirmLoan(c, { loanId: s.loan }, clock) },
  // A loan it can't see is "already gone" to the outsider (a retry): ok, and the footprint check shows ours stays.
  { name: "discardLoan", gate: "manage", kind: "write", run: (c, s) => finance.discardLoan(c, { loanId: s.loan }) },
  { name: "saveYearEndValues", gate: "manage", kind: "write", run: (c) => finance.saveYearEndValues(c, { year: 2026, values: {} }) },
  { name: "saveHensSchedules", gate: "manage", kind: "write", run: (c) => finance.saveHensSchedules(c, { year: 2026, values: {} }) },
  { name: "runClose", gate: "manage", kind: "write", run: (c) => finance.runClose(c, { year: 2025 }, clock) },
  { name: "openFiscalYear", gate: "manage", kind: "write", run: (c) => finance.openFiscalYear(c, { year: 2026 }, clock) },
  { name: "closeFiscalYear", gate: "manage", kind: "write", run: (c) => finance.closeFiscalYear(c, { year: 2025 }, clock) },
  { name: "reopenFiscalYear", gate: "manage", kind: "write", run: (c) => finance.reopenFiscalYear(c, { year: 2025 }) },
];

/** What a caller got, as text: bigints as digits, a zip's files unpacked, any other file decoded. */
const textOf = (value: unknown) =>
  JSON.stringify(value, (_, v) => {
    if (typeof v === "bigint") return String(v);
    if (v?.type === "Buffer" && Array.isArray(v.data)) {
      const bytes = Buffer.from(v.data);
      return bytes.subarray(0, 2).toString() === "PK" ? [...unzip(bytes).values()].join("\n") : bytes.toString("utf8");
    }
    return v;
  });

describe("finance roles (SPEC-finance §8, FX2, FCX1; SPEC-m5 PA5)", () => {
  let owner: TenantContext, outsider: TenantContext;
  const s = {} as Seed;
  // Our organisation's rows another organisation could touch: none may move during its calls.
  const footprint = () =>
    Promise.all([
      db.auditEvent.count({ where: { organizationId: owner.organizationId } }),
      db.journalEntry.count({ where: { organizationId: owner.organizationId } }),
      db.change.count({ where: { organizationId: owner.organizationId } }),
    ]);

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [owner, outsider] = await twoTenants();
    for (const ctx of [owner, outsider]) {
      // Both keep a ledger, so the outsider walks the same paths as the owner.
      const entity = (await listLegalEntities(ctx))[0].id;
      expect(await finance.changeAccountingChoices(ctx, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 }, clock)).toMatchObject({ ok: true });
    }
    s.entity = (await listLegalEntities(owner))[0].id;
    Object.assign(s, { farm: uuidv7(), house: uuidv7(), box: uuidv7(), bank: uuidv7(), batch: uuidv7(), expense: uuidv7() });
    const seeded = await push(
      owner,
      [
        m("farm-registry.createFarm", { id: s.farm, name: "Ferme A", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: s.house, farmId: s.farm, name: "B1", areaM2: 1000, capacity: 12000, type: "closed" }),
        m("finance.createTreasuryAccount", { id: s.box, kind: "cash", name: "Caisse" }),
        m("finance.createTreasuryAccount", { id: s.bank, kind: "bank", name: "Banque" }),
        m("flock.placeBatch", { id: s.batch, houseId: s.house, species: "broiler", strainId: "ross-308", placedOn: "2026-03-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "Couvoir Atlas", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null, ageAtPlacementDays: 0 }),
        m("finance.recordExpense", { id: s.expense, day: "2026-03-02", category: "electricity", amountCentimes: "50000", paidFrom: "credit", treasuryId: null, note: null }),
      ],
      registry,
    );
    expect(seeded.results.filter((r) => r.status !== "applied")).toEqual([]);
    await finance.postPending(owner);

    const manual = { id: uuidv7(), day: "2026-01-01", label: "Soldes d’ouverture", lines: [line("5141", "2000000", "0", s.bank), line("1111", "0", "2000000")] };
    expect(await finance.postManualEntry(owner, manual, clock)).toEqual({ ok: true, value: undefined });
    s.manual = manual.id;
    s.bankLine = (await db.journalLine.findFirstOrThrow({ where: { entryId: manual.id, account: "5141" } })).id;
    const statement = await finance.addBankStatement(owner, { treasuryId: s.bank, endDay: "2026-01-31", closingCentimes: "2000000" }, clock);
    if (!statement.ok) throw new Error(statement.error);
    s.statement = statement.value;
    const bought = asset({ paidWith: "credit", treasuryId: null });
    expect(await finance.createFixedAsset(owner, bought, clock)).toEqual({ ok: true, value: undefined });
    s.asset = bought.id;
    const borrowed = loan(s.bank);
    expect(await finance.createLoan(owner, borrowed, clock)).toEqual({ ok: true, value: undefined });
    s.loan = borrowed.id;
    const planned = budget();
    expect(await finance.saveBudget(owner, planned)).toEqual({ ok: true, value: planned.id });
    s.budget = planned.id;
  }, 60_000);

  for (const row of ROWS) {
    it(`${row.name}: ${row.kind} behind ${row.gate === "read" ? "money.read" : `finance.${row.gate}`}`, async () => {
      const allowed: readonly Role[] = GATES[row.gate];
      // Refused roles first, then the other organisation, then the allowed roles, the owner last.
      for (const role of ROLES.filter((r) => !allowed.includes(r))) expect(await row.run({ ...owner, role }, s), role).toEqual({ ok: false, error: "FORBIDDEN" });

      const before = await footprint();
      const foreign = await row.run(outsider, s);
      if (row.ours) expect(foreign.ok ? foreign : foreign.error, "another organisation").toBeOneOf(["NOT_FOUND", "FORBIDDEN"]);
      const text = textOf(foreign);
      expect([owner.organizationId, ...Object.values(s)].filter((id) => text.includes(id)), "another organisation reads our ids").toEqual([]);
      expect(await footprint(), "another organisation changed our rows").toEqual(before);

      for (const role of ROLES.filter((r) => allowed.includes(r))) {
        const got = await row.run({ ...owner, role }, s);
        if (row.kind === "read") expect(got, role).toMatchObject({ ok: true });
        else expect(got, role).not.toEqual({ ok: false, error: "FORBIDDEN" });
      }
    });
  }

  it("covers every function finance/index.ts exports, and every finance mutation", () => {
    const exported = Object.entries(finance).filter(([, v]) => typeof v === "function").map(([k]) => k);
    const covered = new Set([...ROWS.map((r) => r.name.split(" ")[0]), ...Object.keys(SKIPPED)]);
    expect(exported.filter((name) => !covered.has(name)), "add these to ROWS or SKIPPED").toEqual([]);
    expect([...covered].filter((name) => name !== "financeSync" && !exported.includes(name)), "no longer exported").toEqual([]);
    const pushedTypes = ROWS.filter((r) => r.name.startsWith("financeSync push ")).map((r) => r.name.slice("financeSync push ".length));
    expect(pushedTypes.sort()).toEqual(Object.keys(finance.financeSync.mutations).sort());
  });
});
