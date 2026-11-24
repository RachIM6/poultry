# Implementation plan: M2 finance core

_v0.1, 3 Nov 2026. Status: **draft**. Implements [SPEC-finance.md](../SPEC-finance.md) §4 under [ADR-010](../docs/decisions/ADR-010-accounting-model.md). Covers the `finance` part of M2 only; `reporting`, `documents` and `biosecurity` get their own plan. **Do not start before checkpoint M1** ([plan.md](plan.md))._

_2026-11-14: started before checkpoint M1. The product owner set hosting (OQ1) and SMS (OQ2) aside and asked to keep building, so the pilot part of the checkpoint stays open. The accounting ADR was renumbered ADR-010: ADR-009 is the zod-free `shared.ts` decision (T25)._

Definition of done, file layout (strict module: `domain/`, `application/`, `infrastructure/`) and verification commands are the same as [todo.md](todo.md). Every money function gets the fixture from SPEC-finance §7 as its first test.

## Dependency graph

```
T27 profile v2 ── T28 charts ── T29 ledger core ── T30 posting pipeline (purchases, payments)
                                                       ├── T31 sales, cheques and bills
                                                       ├── T32 treasury + quick expense
                                                       └── T39 VAT (after FQ4)
T31 ── T33 ageing + credit limits
T30 + T31 ── T34 batch result + allocation ── T35 budget + break-even
T29 ── T36 books + trial balance ── T38 export
T31 ── T37 5 M DH tracker
```

## Tasks

### T27: Accounting profile v2 (FN1)
**Description:** Replace `AccountingProfile` in `farm-registry` with `{ books, base, overlays, coOwnerShares }` per the ADR-010 table. Owner can change overlay, books and fiscal-year dates while the year has no entry.
**AC:**
- [x] `accountingProfileOf` returns the ADR-010 table for all 6 legal forms, cooperative and association included (unit test replaces the current one). (`src/modules/farm-registry/schema.test.ts`; the owner's stored choices, `LegalEntity.books`, `pcaOverlay` and `fiscalYearStartMonth`, override the defaults: `service.int.test.ts`.)
- [ ] Changing the profile after the first entry of the year is refused with a typed error. **Moved to T29** (2026-11-14): only `finance` knows whether the year has an entry, and `farm-registry` can't depend on `finance`. T29 adds the change use case in `finance`, which checks its own entries and then saves through a `farm-registry` index function.
**Files:** `src/modules/farm-registry/schema.ts`, `service.ts`, Prisma `LegalEntity` (fiscal-year start)
**Size:** S

### T28: Charts of accounts (FN2)
**Description:** `Account` and `ChartOverlay` tables, seed of the CGNC accounts used by FN6 and the PCA overlay of FN2, each with its source. Entity sub-accounts (bank, cash box).
**AC:**
- [x] Every account referenced by a default posting rule exists in every chart the rule targets (unit test over the seed). (`src/modules/finance/domain/chart.test.ts`, over FN6's accounts until T30 makes them rule rows: with PCA, each account itself; without, FN2's CGNC account.)
- [x] Roll-up of 612122 gives 61212 → 6121 → 612 → 61 → 6 through `parentNumber`. (Same test.)

Done 2026-11-14 (branch `feat/t28-charts`):
- `LedgerAccount` (chart, number, label, parent, fallback). It is reference data, the same for every organisation; `Account` was taken by Better Auth. The 54 accounts in `prisma/seed/finance/accounts.json` are the FN6 rules' accounts and their parents, with labels **as printed** in the official PCA (finances.gov.ma, "Plan Comptable Agricole -vf-dec2015.pdf", which reproduces the CGNC nomenclature). The CGNC text itself (> 10 MB) wasn't read: the labels of the base accounts are the PCA's reproduction of it.
- No `ChartOverlay` table: an overlay is the `chart` tag. Bank and cash sub-accounts per organisation come with T32.
- **Found for the accountant:** the PCA nests 612123 (vet products) under 61212 → 6121, but FN2 posts it to 6122 when the PCA is off. Each PCA account therefore has an explicit `fallback` (FN2's column); roll-ups follow the official tree. Even the final PCA file is headed « Projet » (FQ1).
- **Lead for FQ2:** the Ministry publishes the cooperatives' chart of accounts (2001) at finances.gov.ma/Publication/depp/2008/4717_pcdescooperatives.pdf. To be read by the finance session or the accountant.
**Size:** M

### T29: Ledger core (FN4, FN5)
**Description:** `JournalEntry`, `JournalLine`, `FiscalPeriod`. Domain checks, deferred constraint trigger re-checking the balance at commit, reversal, period locking by the owner, audit, à-nouveaux entry at fiscal-year opening.
**AC:**
- [x] Unbalanced, one-line, two-sided and unknown-account entries are rejected by the domain; an unbalanced entry inserted directly in SQL fails at commit (integration test). (`finance/domain/entry.test.ts`, `finance/ledger.int.test.ts`: a deferred constraint trigger on both tables.)
- [x] Opening a fiscal year posts an à-nouveaux entry carrying forward classes 1–5 of the previous year. (`openFiscalYear`: OD on the year's first day, once per year by its source key. ⚠️ For the accountant: the previous year's net result (classes 6–7) is carried on 1191 / 1199 so the entry balances, until it is allocated.)
- [x] A posted entry cannot be updated or deleted; reversal links to the original. (A trigger refuses UPDATE and DELETE; `reverseEntry` once per entry, `reversesId` unique.)
- [x] A locked period refuses entries; a correction lands in the first open period. (`LockedPeriod` per month; `setPeriodLocked`, owner only, audited.)
- [x] (From T27) Changing the accounting profile (books, PCA overlay, fiscal-year start) once the fiscal year has an entry is refused with a typed error. (`changeAccountingChoices` → `FISCAL_YEAR_HAS_ENTRIES`; the legal entity's row is locked so a first entry can't slip in meanwhile.)
Done 2026-11-14 (branch `feat/t29-ledger-core`): permissions `finance.record` (owner, manager) and `finance.manage` (owner); entries are posted by the server only, for now through `postEntry` in a caller's transaction (T30's pipeline). No screen yet: the books views are T36. The first year in Dawra is opened by hand with an OD entry from the accountant's balance sheet (FQ11 for cash_book entities).

**Size:** L

### T30: Posting pipeline, purchases and payments (FN6–FN8)
**Description:** `PostingRule` (versioned, with entity overrides), pure `post(event, rules)`, `PostingCursor` per source, `inventory.listChangedSince` and `flock.listChangedSince` (chick purchase at placement). Rules for purchases and supplier payments (cash, transfer, cheque issued, bill accepted). Runs after each sync push.
**AC:**
- [x] Replaying the same sync twice creates no new entry (integration test). (`finance/posting.int.test.ts`: the cursor moves, and the source key `(module, id, change version)` is unique.)
- [x] Editing a purchase posts a reversal and a new entry. (Any newer version of a record whose entry differs; a version that leaves the books alone, like a batch closing, posts nothing.)
- [x] With PCA off, a feed purchase posts to 6121.
Done 2026-11-14 (branch `feat/t30-posting-pipeline`):
- `finance/domain/posting.ts` holds FN6's purchase and chick rules as data (pure), mapped to the entity's chart.
- The cursor is the organisation's sync change log: `inventory.purchasesChangedSince` and `flock.placementsChangedSince` read it, one `PostingCursor` per source, row-locked.
- `postPending` runs after each push through Next's `after()`, so the phone doesn't wait.
- An entry whose month is locked goes to the first open month.

Not yet:
- **Supplier payment rules:** M1 records no supplier payment, only the part paid at the purchase. That part goes to 5161 (cash), because M1 doesn't record how it was paid. ⚠️ until purchases carry a payment method (T32).
- **`PostingRule` table:** the rules are code. ~~FN8 overrides~~ built 2026-11-24 (branch `feat/posting-overrides`): `PostingOverride`, an append-only history per entity; `/settings/posting`, owner only, audited; applied by the pipeline and quick expenses before mapping to the chart (SPEC-finance FN8, §9 "Posting overrides").
- **The "other" item kind:** it goes to 61221; FN6 has no rule for it (for the accountant).
- **One legal entity per organisation,** as onboarding creates.

**Size:** L

### T31: Sales, cheques and bills (FN6, FN11)
**Description:** `sales.listChangedSince`, rules for sales and receipts, portfolio of cheques and bills with states and reminders.
**AC:**
- [x] A cheque received posts D 5111 / C 3421; cashed posts D 5141 / C 5111; unpaid moves the claim to 3424 and blocks the buyer for credit. (`finance/domain/posting.test.ts`, `finance/instruments.int.test.ts` through the sync push; `e2e/receivables.spec.ts` offline.)
- [x] Reminder notification on the agreed date. (Already sent since T22 for a sale's cheque or bill; a later payment's cheque has no agreed date in M1.)
Done 2026-11-14 (branch `feat/t31-instruments`):
- **Portfolio:** `InstrumentStatus`, an append-only log owned by `sales`. Its id is a UUIDv7 from the phone, and each step happens once per instrument. A sale paid at once by cheque or bill, or a later payment by cheque or bill, *is* the instrument: no copy is kept.
- **Moves:** forward only (portfolio → remitted → cashed | unpaid), through `sales.setInstrumentState` (owner, manager).
- **Unpaid:** puts the amount back on the buyer's balance, and sets `Buyer.creditBlocked`. A sale paid less than in full is then refused (`BUYER_CREDIT_BLOCKED`) until the owner sends `sales.unblockBuyer`.
- **Postings:** sales (VT), later payments (CA/BQ/EF) and each instrument step (EF/BQ) go through T30's pipeline. A remitted cheque stays on 5111, so it posts nothing. A reversal now uses the journal of the entry it cancels.
- **Screen:** the receivables screen lists the pending cheques and bills, with buttons for the allowed moves, and the blocked buyers, with "Lever le blocage" for the owner.

Not yet:
- ~~A later payment's cheque number and due date.~~ Done 2026-11-20 (branch `feat/payment-instruments`): on the receivables screen, a later payment by cheque or bill asks for its number and agreed date, as a sale does (`BuyerPayment.instrumentNumber`, `instrumentDueOn`). The portfolio shows them, the cash schedule collects it on that date instead of the payment day, and the reminder job (V4) announces it once on that day, like a sale's. ~~Open question: a sale's reminder announces the sale's amount, the portfolio its paid part; they differ for a cheque covering part of a sale.~~ Settled 2026-11-22 (branch `fix/m6-followups`): the reminder announces the instrument's own amount, the part paid with it, as the portfolio shows; a cheque sale with nothing paid is not in the portfolio and gets no reminder (`sales/receivables.int.test.ts`).
- Issued cheques and bills (supplier side, with T32's payments).

**Size:** M

### T32: Treasury and quick expense (FN3, FN10, FX4)
**Description:** Bank accounts and cash boxes (opening balances through the à-nouveaux entry of T29; `cash_book` entities enter bank and cash balances only), transfers via 5115, treasury screen, offline quick-expense form on the phone (manager and owner), optional receipt photo.
**AC:**
- [x] A quick expense recorded offline is posted once after sync. (`finance/treasury.int.test.ts`: the same mutation twice, or the same expense in another mutation; `e2e/expenses.spec.ts`: recorded offline, reloaded from the service worker, one expense and one entry on the server after sync.)
- [x] A worker cannot open the quick-expense screen or any finance endpoint (integration test). (Every finance mutation is `finance.record`; workers pull no treasury account, expense or transfer; `treasuryOverview` is refused; the screens say so.)

Done 2026-11-15 (branch `feat/t32-treasury-expenses`):
- **Treasury accounts:** `TreasuryAccount` holds the bank accounts and cash boxes. Their ledger lines carry the account's id as a tag (`JournalLine.treasuryId`) on 5141 / 5161, rather than a sub-account number per organisation. A reversal keeps the tag.
- **Expenses and transfers:** `Expense` and `TreasuryTransfer` are finance's own records, synced from the phone. They are posted in the same transaction as they arrive (source key `finance:<id>`), into the first open month when theirs is locked.
- **Expense accounts:** electricity 612512, water 612511, vet fees 6136, insurance 6134, catching crew or transport 612612. Paid from cash 5161 (CA), bank 5141 (BQ), or on credit 4411 (AC).
- **Transfers:** two entries through 5115 (FN6).
- **Screens:**
  - `/expenses` is a static shell, precached and offline: the expense form, the last 20 expenses, and adding a cash box or bank account.
  - `/treasury` is online, owner and manager: the balances and this month's movements.

Not yet:
- ~~The receipt photo.~~ Done 2026-11-20 (branch `feat/expense-receipts`): once an expense is on the server and the phone online, "Ajouter le reçu" on `/expenses` uploads a photo or PDF (ADR-011: `POST /api/files?purpose=receipt&expense=<id>`, owners and managers, attached once, `Expense.receiptFileId`). `/treasury` gets a "Reçu" column (FN10): Voir, or Manquant for an expense without one. Not yet: queuing the photo while offline (ADR-011). The accountant partner reads receipts (`money.read`, like the books and their export) but adds none (fix 2026-11-20, branch `fix/accountant-receipts`: before it, their export had no `pieces/`).
- Opening balances by hand: an OD entry through `postEntry` works, but there is no screen; FQ11 for cash_book entities.
- ~~Supplier payments.~~ Done 2026-11-20 (branch `feat/supplier-payments`): on `/stock`, "Payer" under a supplier who is owed something records a later payment offline (cash, transfer, cheque issued, bill accepted), never above what is owed (`PAID_MORE_THAN_OWED`, under the supplier's row lock). Inventory owns `SupplierPayment` (S2: balance = purchases − paid at once − later payments); finance posts FN6's rows: D 4411 / C 5161 (CA), 5141 (BQ, the cheque on its issue date) or 4415 (OD). Hidden from vets, shown to accountants. The issued side of FN11 came on 2026-11-20 (branch `feat/issued-instruments`): a later payment by cheque or bill can carry its number and agreed date; every cheque and bill issued (a purchase's paid part too, dated on the purchase day) is listed under its supplier on `/stock` until marked "Débité" (`inventory.debitIssued`, `IssuedDebit`, once per instrument, not before its issue day). A debited bill posts D 4415 / C 5141 in BQ (FN6 row 73); a cheque posts nothing more (it left the bank on its issue day). The cash schedule counts accepted bills not yet debited as outflows on their agreed date. Reminders came the same day (branch `feat/issued-reminders`): the scheduler (`/api/push/dispatch`) announces each later payment's cheque or bill once, from the start of its agreed day, to owners and managers, unless already debited (`issuedDue`, a money notification; `SupplierPayment.instrumentRemindedAt` claims it). A purchase's paid part has no agreed date, so no reminder. Not yet: an issued cheque returned unpaid. Supplier due dates (FN12) came with `feat/supplier-dues`.
- ~~The payment method on purchases.~~ Done 2026-11-20 (branch `feat/purchase-paid-method`): the purchase form asks "Payé par" (cash, transfer, cheque issued, bill accepted), stored as `Purchase.paidMethod` (default cash: older purchases and queued writes post as before). The paid part leaves where a later supplier payment would (FN6, `PAID_OUT`): 5161, 5141 for a transfer or an issued cheque, 4415 for a bill, in the purchase's AC entry. Hidden from workers like the other purchase money fields.

**Size:** M

### T33: Ageing and credit limits (FN12)
**AC:**
- [x] Ageing buckets match the fixture (77 days → 61–90). (`sales/domain/receivables.test.ts`; later payments settle the oldest debts first.)
- [x] A credit sale above the buyer's limit waits for the owner's approval. (`sales/credit.int.test.ts`; `e2e/receivables.spec.ts` approves offline.)

Done 2026-11-15 (branch `feat/t33-ageing-credit-limits`), decisions taken without asking:
- **Due dates:** a credit sale is due on its sale day, because M1 records no payment terms; an unpaid cheque or bill is due on its agreed date.
- **Credit limit:** `Buyer.creditLimitCentimes`, set by the owner (`sales.setCreditLimit`), stripped for workers.
- **A sale past the limit is still recorded:** the birds have left, and refusing it after an offline sync would lose a real sale. It's marked `Sale.creditApproval = "pending"` and the owners get a `creditApproval` notification (a money template, owners only). The owner approves it with `sales.approveCredit`.
- **The owner's own sales:** never held, since the owner is the one who approves.
- **Receivables screen:** each owing buyer's debts by age and their limit, the credits waiting for approval, and the owner's list of limits.

Not yet:
- ~~The supplier side of FN12 (amounts due by due date).~~ Done 2026-11-20 (branch `feat/supplier-dues`): on `/stock`, each supplier lists what is still due by due date (a purchase without one is due on its day), later payments settling the oldest first as for buyers (`supplierDues`); overdue amounts in brick.
- Refusing a pending credit: the owner can block the buyer (T31) instead.

**Size:** S

### T34: Batch result and shared-cost allocation (FN13, FN14)
**Description:** Batch P&L from tagged lines and valued consumptions, `allocate` with bird-days default, freeze at close. Migrate the M1 T24 "other cost" entries.
**AC:**
- [x] B-2026-13 fixture: margin 44 210,00, 1,87 DH/kg, cost 11,43 DH/kg. (`finance/domain/batch.test.ts`, plus 14,0 %.)
- [x] Allocated parts always sum to the shared total (property test). (500 random runs; also with frozen shares, `finance/batch-results.int.test.ts`.)
- [x] A closed batch keeps its allocation when the key changes. (B's deaths in October and a new shared expense after A closed: A keeps 3 100,00.)
- [x] A feed purchase tagged with the batch does not change its cost; only the valued consumption does. (A purchase is never a batch cost: 85 kg consumed → 382,50.)
- [x] An electricity bill paid in November with service period October is split across the batches present in October. (3 900,00 by 31 000 / 8 000 bird-days → 3 100,00 / 800,00.)

Done 2026-11-15 (branch `feat/t34-batch-result`), decisions taken without asking:
- **Computed from facts, not ledger tags.** `batchResults` reads sales per batch (`sales`), chicks, M1 other costs and kg sold (`flock`), valued consumptions (`inventory`), and finance's own expenses. The cost is chicks + consumptions + other costs + direct expenses + the allocated share.
  - **M1 other costs:** T24's entries count as direct charges as they are; they are not migrated or posted. New ones are quick expenses aimed at the batch.
- **Allocation:**
  - An expense is aimed at one batch (direct), shared over a month's batches (`serviceMonth`), or general (no batch).
  - The only key is bird-days. House m² and kg sold come when an owner asks.
  - An open batch counts as present until the end of the service period.
- **Freeze:** after each push, `freezeClosedBatches` stores a closed batch's share of every shared expense (`FrozenAllocation`, `FrozenBatch`). Later splits share only what's left of each expense among the batches still open, so the parts always sum to the expense.
- **Screens:**
  - The quick-expense form has "Imputation" (shared by default, an open batch, or general) and the month.
  - `/results` is online (owner, manager): each batch's sales, cost, margin, margin and cost per kg, % of sales, and the cost breakdown, newest first, which serves as FN13's comparison with past batches.

Not yet:
- ~~The comparison of mortality, FCR, feed price and price per kg next to the result.~~ Done 2026-11-20 (branch `feat/results-kpis`): under each batch on `/results`, "Mortalité · IC · aliment DH/kg · vendu DH/kg" (`batchComparison`, integers: ‰ dead and culled per started bird, feed grams × 1000 ÷ grams sold, the feed consumed's cost per kg from `batchConsumption`, sales ÷ kg sold). "—" where nothing was eaten or sold.
- The ledger's analytic tags (batch on 712x lines).

**Size:** L

### T35: Budget and break-even (FN15)
**AC:**
- [x] Break-even and planned margin recompute on feed-price and sale-price input. (`finance/domain/budget.test.ts`, with the §7 fixture 270 800,00 ÷ 23 700 kg → 11,43; `e2e/budget-plan.spec.ts`: the feed price moves the break-even, the sale price moves only the margin.)

Done 2026-11-15 (branch `feat/t35-budget`):
- `budgetOf` is pure and Zod-free: `/budget` recomputes it on every keystroke, the same code as the server.
- **Copied from a closed batch** (`budgetBases`): its chicks and their price, the feed it ate (kg and average price, from `inventory.batchConsumption`), the rest of its cost, its kg sold and average sale price.
- **Saved budgets** (`Budget`: the inputs only, the figures are recomputed) through a server action, owner and manager, audited.
- `/budget` is online.

The weekly cash need came on 2026-11-20 (branch `feat/cash-schedule`) from facts, not from the budget: `/treasury` runs today's cash and bank (5161, 5141) forward over 4 weeks with the cheques and bills to collect and what is due to suppliers, overdue amounts in the first week (F-Effects' schedule). Not yet: a budget's own week-by-week need, which would need feed bought by week and supplier credit terms the app doesn't record.

**Size:** M

### T36: Books and trial balance (FN16)
**AC:**
- [x] Cash-book view for `cash_book` entities; journals, ledger and trial balance for `ledger` entities. (`finance/books.int.test.ts` with the same M1 events in both kinds of entity; `e2e/books.spec.ts`.)
- [x] Trial balance is balanced for any sequence of M1 events (property test). (`finance/domain/books.test.ts`: 200 random runs over every posting rule, purchases to instrument steps, expenses and transfers.)

Done 2026-11-15 (branch `feat/t36-books`):
- `trialBalance` and `cashBookOf` are pure.
- `readBooks(ctx, month)` gives every entity its cash book. A `ledger` entity also gets the month's journals, and the general ledger and trial balance from the fiscal year's first day, so the à-nouveaux entry is in them. Labels come from the chart.
- **Cash book scope:** the lines on 51xx, without 5115 (a transfer only passes through it; its two legs show on the accounts it moves money between).
- `/books` is online (owner, manager): month navigation, and only the views the profile keeps.

The batch column came on 2026-11-20 (branch `feat/cash-book-batch`): `readBooks` returns each entry's tags (the export's, read from its source record, `application/tags.ts`), and the cash book shows and exports the batch of each line ("B1 · 01/03/2026": house and placement day), blank for a general expense or a transfer.

**Size:** M

### T37: 5 M DH tracker (FN17)
**AC:**
- [x] Fixture 4 260 450 + 690 000 → 99 %; alert from 90 %. (`finance/domain/threshold.test.ts`; `finance/threshold.int.test.ts` with a booked sale and a saved budget; `e2e/threshold.spec.ts`: the dashboard warns at 91 %.)

Done 2026-11-15 (branch `feat/t37-threshold`), decisions taken without asking:
- **The threshold is configuration with a validity date** (`finance/domain/threshold.ts`, `THRESHOLDS`). A change of law adds an entry, never edits one. The first entry holds 5 000 000,00 DH from 2026-01-01, and its rule text in FR and AR cites CGI art. 47-I and art. 6-I-A-29° (NEEDS-ANALYSIS §3) and says to confirm the conditions with the accountant (FQ5).
- **Booked:** the 712x lines of the fiscal year (credit − debit).
- **Planned:** the planned sales of the budgets saved during the fiscal year. An open batch has no planned sales of its own unless a budget gives them.
- **Percent:** rounded down. The alert is from 90 %.
- **History:** the last 3 fiscal years, each marked when over the threshold (for the "3 years in a row" rule).
- **Screens:** `/threshold` (online, owner and manager), and a warning at the top of the dashboard from 90 %.

The push notification came on 2026-11-20 (branch `feat/threshold-push`): after each posting run, a fiscal year at 90 % or more notifies the owners and managers once (`ThresholdAlert` claims the year; not urgent, so quiet hours hold it). `finance` may now call `notifications` (CAPABILITY-MAP, lint rule), like every other module that alerts.

**Size:** S

### T38: Export to the accountant (FN18)
**AC:**
- [x] CSV and Excel per period open in Excel with French formatting. (`finance/domain/export.test.ts`, `lib/xlsx.test.ts`, `finance/books.int.test.ts`, `e2e/books.spec.ts`: the link on `/books` downloads the zip. Opened by hand in Excel 16: the .xlsx opens without repair, with numbers and dates; the CSV, read with French separators, gives numbers and keeps accents.)
- [x] Zip with receipts: `pieces/<day>_<entry id>.<ext>`, the receipts of the expenses whose entry falls in the month, named after the entries sheet's "Pièce" (2026-11-20, branch `feat/expense-receipts`; `finance/treasury.int.test.ts`, `finance/domain/export.test.ts`). `finance` now depends on `documents` to read them (CAPABILITY-MAP, lint rule).

Done 2026-11-16 (branch `feat/t38-export`), decisions taken without asking:
- **One download per month:** `GET /api/finance/export?month=YYYY-MM` (owner, manager) gives `comptabilite-YYYY-MM.zip` with one CSV per sheet and the same sheets in `livres-YYYY-MM.xlsx`. It reuses `readBooks`, so it holds what `/books` shows: a `ledger` entity gets the entries, the trial balance (from the fiscal year's first day) and the cash book; a `cash_book` entity gets the cash book only.
- **No new dependency:** the zip writer (`lib/zip.ts`, `node:zlib`) and the .xlsx writer (`lib/xlsx.ts`, minimal SpreadsheetML) are a few dozen lines each. Amounts are written from the bigint, never through a float.
- **CSV for French Excel:** UTF-8 with BOM, `;`, decimal comma without thousands separator, dates dd/mm/yyyy, CRLF. A text starting with `= + - @` gets a `'` in front (CSV injection).
- **Headers in French** in both locales: the CGNC and the accountants work in French.
- **Entry columns** are FN18's. "Pièce" is the entry id (stable, traces back to the app). Party, farm, house and batch are empty: ledger lines carry no analytic tag yet (see T34, T36).

The analytic columns came on 2026-11-20 (branch `feat/export-analytics`): Tiers, Ferme, Bâtiment and Lot are read at export from the record each entry posts (its source), so entries posted earlier get them too, and a reversal its original's: a purchase's supplier and farm, a supplier payment's supplier, the chicks' batch, a sale's buyer and batch, a buyer payment's or cheque step's buyer, an expense's batch, an advance's employee and farm, a pay month's or wage payment's farm. Lot is the batch's placement day (dd/mm/yyyy), next to its house. Each module answers for its own records (`ledgerTagsOf` in inventory, sales and workforce; `batchPlaces` in flock; `placeNames` in farm-registry). Transfers and the opening entry have none.

Not yet: the accounting software's own import format (M6, FQ10).

**Size:** M

### T39: VAT on purchases and sales (FN9), after FQ4
**AC:**
- [x] VAT-registered entity: recoverable VAT on 34552, collected VAT on 4455; otherwise the total goes to the charge. (`finance/domain/posting.test.ts`; `finance/posting.int.test.ts`: a registered entity's purchase and sale through sync and the pipeline, VAT above the total refused; `e2e/vat.spec.ts`: the purchase form's VAT lands on 3455.)

Done 2026-11-20 (branch `feat/t39-vat`), decisions taken without asking, FQ4 still open:
- **Mechanism only, off by default:** `LegalEntity.vatRegistered` is false, as FN9 says until FQ4 is answered. It changes with the other accounting choices (`changeAccountingChoices`, only while the fiscal year has no entry); no screen yet (F-Profile).
- **The VAT amount is typed from the invoice,** never computed: no rate is stored, so none is assumed. Optional "Dont TVA" on the purchase form and the three sale forms; it must not exceed the total (`VAT_MORE_THAN_AMOUNT`, client and server). Older queued writes without it count as 0.
- **3455, not 34552:** the PCA nomenclature (our source for the chart) lists 3455 "Etat - TVA récupérable" without the CGNC's five-digit split, so recoverable VAT goes to 3455 until the accountant asks for 34552. 4455 "Etat, TVA facturée" is in it. Both added to `accounts.json`, labels from the PCA text; deploy runs `pnpm db:seed` (it upserts).

Not yet: batch results, budgets and stock valuation still use the invoice totals (TTC), which is right for a non-registered farm; for a registered one they should exclude VAT (FQ4). Chicks bought at placement carry no VAT field; quick expenses got theirs on 2026-11-20 (branch `feat/t39b-expense-vat`: same optional "Dont TVA", 3455 for a registered entity). No VAT return (4456).
**Size:** S

### ✅ Checkpoint M2-finance
- [ ] An expert-comptable has reviewed the charts and posting rules (T28, T30, T31) and imported one exported month (T38).
- [ ] The pilot farm's batch margin matches the owner's own calculation.
- [ ] SPEC-finance §8 criteria met.
