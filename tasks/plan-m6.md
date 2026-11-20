# Implementation plan: M6 accounting close

_v0.1, 20 Nov 2026. Status: **draft**. Implements [SPEC-finance.md](../SPEC-finance.md) §5 (FCX1–FCX6, FC1–FC10) under [ADR-010](../docs/decisions/ADR-010-accounting-model.md). Module: `finance` (strict), plus small changes in `sales` (FC7). Task numbers T100–T119 (T90–T99 are M5)._

Definition of done, file layout and verification commands are the same as [todo.md](todo.md). Every money function gets its SPEC-finance §7 or §7.1 fixture as its first test. Each task goes domain test → integration test (tenant isolation, roles: worker nothing, accountant read-only, owner-only actions) → screen → Playwright spec, then lint, typecheck, `pnpm test` and the spec. M6 screens are online, server-rendered like `/books`, and linked from "Plus" › Argent. Nothing new goes on `/batches` (JS budget). All strings go in `fr.json` and `ar.json` (FX5).

**Most of M6 waits for T100.** Almost every FC rule posts to an account that isn't seeded yet. T100 seeds those accounts from the official PCA PDF, which isn't in the repository. Until the owner provides it or allows the download, only T107, T110 and T111 can be built: they post nothing, or only to accounts already seeded.

## Defaults taken without asking (SPEC-finance §5, to confirm with the accountant)

| Question | Default | Where |
|---|---|---|
| FQ9 prorata | By whole months: the in-service month counts in full, the disposal month doesn't; cumulative rounding | FC1, T102 |
| FQ16 loans | Interest per period = annual rate ÷ periods per year; no accrued interest at year end (manual entry if wanted) | FC2, T105 |
| FQ17 subsidies | Booked when received (D 5141 / C 1311); released to 7577 in proportion to the assets' depreciation, through the equity contra account (candidate 1319, unverified: T100); refused on land | FC2, T106 |
| FQ18 eggs | Value per egg typed by the owner | FC5, T113 |
| FQ19 batch in progress | FN13's cost only, split by head between birds on hand and birds sold | FC4, T109 |
| FQ20 current value | Last weighing × last sale price for a batch; cost for a stock unless the owner lowers it | FC4, FC5, T108, T109 |
| FQ21 home consumption | Prefilled with the last sale price; an employee's share on 6171 | FC7, T112 |
| NQ7 accountant writes | The accountant approves outside the app; the owner closes the year | FCX6, T104 |
| Close entries | Reversed on the next year's first day, provisions included | FCX5, T104 |

No life, rate, tax rate, price or bank file format is stored or suggested anywhere: the user types lives and rates from the contract or the accountant.

**Candidate accounts** (SPEC-finance §5 "Candidates"): numbers that are neither seeded nor in the original M6 summary. They are written as candidates, never as fact:

| Role | Candidate |
|---|---|
| Debts on fixed-asset acquisitions | 4481 |
| Net book value of tangible assets disposed of | 6513 |
| Proceeds of tangible-asset disposals | 7513 |
| Subsidy amounts taken to income | 1319 |
| Provision on materials and supplies | 3912 |
| Reversals of current-asset provisions | 7196 |
| Bank services | 6147 |
| Furniture and office equipment | 235x |

T100 confirms or replaces each from the text before any rule uses it.

## Dependency graph

```
Buildable now (no new account)
T107 count sheet
T110 draft balance sheet
T111 bank reconciliation, manual matching

Blocked
T100 close accounts         ← the PCA PDF in the repository (owner's OK to download it, or the owner provides it)
 ├── T101 manual entry + opening balances
 ├── T102 assets + depreciation ── T103 close run ── T104 year close + opening reversals
 │                                   ├── T106 subsidies (screen with T105)
 │                                   └── with T104, T107: T108 stocks at close, T109 batches in progress
 ├── T105 loans
 ├── T112 home consumption   (an individual's entry also ← FQ11)
 └── T119 bank fees category (after T111)
T113 eggs at close           ← owner's OK on finance → eggs (CAPABILITY-MAP); after T108
T114 hens, simplified        ← FQ7; after T100
T115 hens, classic           ← FQ7, FQ8; after T100
T116 official statements     ← FQ22
T117 bank statement import   ← real statement samples
T118 accountant import       ← FQ10
```

## Buildable now

### T107: Year-end count sheet (FC3)
**Description:** `/closing/count`:
- the printable sheet per farm: open batches with birds on hand (`flock`); stock items with lot, expiry and book quantity (`inventory`), expired lots flagged; no amount;
- then the counted quantities, entered by the owner or a manager. Saved in `YearEndCount`, audited;
- the gap per line, with links to the stock adjustment (S3) and the daily entry.

It posts nothing. Freezing the count once the close run posts is T103's AC.
**AC:**
- [ ] The sheet lists every open batch and stock item of the farm on the last day; no price or value appears in its HTML (Playwright, print media).
- [ ] Counted quantities save once and can be changed, audited; workers and the accountant can't write them (integration).
- [ ] Finance writes nothing into `inventory` or `flock` (the count only reads their `index.ts`; lint boundary rule green).
**Depends on:** nothing. **Blocked by:** none.
**Size:** M

### T110: Draft balance sheet (FC8, draft part)
**Description:** A "Bilan (projet)" view on `/books` for `ledger` entities. From the trial balance on the year's last day: classes 1–5 by 3-digit account, assets and liabilities, and the result line. Labelled "Projet"; T104 adds "Exercice clôturé le …". Same approach as the draft CPC (U16, `domain/statements.ts`). Uses only posted lines, no new account.
**AC:**
- [x] Σ assets = Σ liabilities + result, and the result equals `incomeStatement(...).net` for the same rows (property over random entries). (`finance/domain/statements.test.ts`)
- [x] Hidden for `cash_book` entities; read by the accountant (Playwright). (`e2e/books.spec.ts`)
**Depends on:** nothing. **Blocked by:** none.
**Size:** S

### T111: Bank reconciliation, manual matching (FC9)
**Description:**
- `BankStatement` (bank account, end day, closing balance) and the ticks on 5141 lines tagged with that `treasuryId`. 5141 is already seeded.
- Screen on `/treasury`: unticked lines, book balance on the end day, difference, "rapproché" at 0.
- Statement lines missing from the books show as the difference until they are booked through existing forms. The "Frais bancaires" category is T119.
**AC:**
- [ ] With a two-week fixture whose statement lines are all in the books, ticking them brings the difference to 0 (integration).
- [ ] A line is ticked on one statement at most; unticking is refused once its month is locked; ticks are audited.
- [ ] Owner and manager write; accountant reads; worker refused.
**Depends on:** nothing. **Blocked by:** none.
**Size:** M

## Blocked

### T100: Close accounts from the PCA nomenclature (FCX3, FC1–FC9)
**Blocked by:** the PCA PDF in the repository: the owner's OK to download it, or the owner provides it. It is the official text that `accounts.json` cites: finances.gov.ma/Publication/depp/2017/Plan Comptable Agricole -vf-dec2015.pdf. Telling CGNC accounts from PCA additions also needs the CGNC nomenclature, under the same condition.
**Description:** Seed the whole nomenclature of the PCA text (classes 1–8, labels as printed) into `prisma/seed/finance/accounts.json`, so manual entries and opening balances can use any account.
- **Charts:** accounts the PCA adds to the CGNC are tagged `pca`, with their CGNC `fallback` (FN2, FQ1).
- **Families:** resolve the numbers §5 leaves open: the asset accounts in 231x–234x and their 28xx; the 31x accounts by stock kind and for the farm's own products; and, for T114, what the text says about the simplified hens method (715).
- **Candidates:** confirm or replace each candidate in the table above.
**AC:**
- [ ] Every account SPEC-finance §5 names exists in the seed with its printed label (unit test listing them). An account the text lacks is listed under "Found for the accountant", and its rule stays out: no number invented.
- [ ] Each candidate (4481, 6513, 7513, 1319, 3912, 7196, 6147, 235x) is confirmed or replaced from the text, with its printed label, and SPEC-finance §5 is updated to the confirmed number before any rule using it is coded.
- [ ] Every account a posting rule uses (`POSTED_ACCOUNTS`, `EXPENSE_ACCOUNTS`) is still a posting account (no sub-account under it) in both charts (`chart.test.ts`, `operations.test.ts` green). If the import gives one of them children, stop and report.
- [ ] `pnpm db:seed` upserts over a database with posted entries; their lines keep their accounts (integration).
- [ ] Roll-up of each new PCA account reaches its class through `parentNumber`.
**Depends on:** nothing.
**Size:** L (data from a PDF)

### T101: Manual entries and opening balances (FCX3, FN3)
**Blocked by:** T100 (opening balances need class 1–5 accounts that aren't seeded).
**Description:** "Écriture manuelle" on `/books` for the owner: day, label, piece reference, optional receipt (ADR-011), lines on any posting account of the entity's chart, live Σdebit − Σcredit. Posted through `postEntry` (OD, source `finance:<id>`). The first year's opening entry is the same form, dated the year's first day.
**AC:**
- [ ] A balanced entry on any leaf account posts once (same id twice → one entry), audited. Unbalanced, one-line and parent-account entries are refused (FN4).
- [ ] Manager, accountant and worker are refused (integration). The accountant sees the entries on `/books`.
- [ ] An entry in a locked month is refused with the reason. It isn't moved: a manual entry is dated by its author.
- [ ] A `cash_book` entity sees the form disabled with the FQ11 reason.
- [ ] Playwright: the owner types a three-line opening entry, it shows in the journal and the trial balance.
**Depends on:** T100.
**Size:** M

### T102: Fixed-asset register and depreciation schedule (FC1)
**Blocked by:** T100 (asset accounts 231x–234x, 28xx, 6193, and the candidates for debts on asset acquisitions, disposed net book value, disposal proceeds and furniture).
**Description:**
- `FixedAsset`, finance's own table: legal entity, label, category, farm and house, acquired and in-service days, cost, VAT, residual value, life in months, payment method, `inOpeningBalance` and its accumulated depreciation, disposal day and price, receipt.
- Pure `straightLine`: cumulative rounding, default prorata FQ9.
- "Immobilisations" screen: each asset's schedule by year. The owner writes; the manager and the accountant read.
- **Postings:**
  - acquisition: D asset account (+ 3455 when VAT-registered) / C 5161, 5141, or the account for debts on fixed-asset acquisitions (candidate 4481, unverified);
  - a later payment of an asset bought on credit: D that account / C 5161 or 5141;
  - disposal (§5 FC1), with the year's depreciation up to it.
- **Category → account:** a map in `domain/`, like `EXPENSE_ACCOUNTS`, filled from T100's confirmed numbers.
**AC:**
- [ ] §7.1 A: 2 254,76 / 6 764,29 / 6 764,28 / 6 764,29 / 6 764,28 / 6 764,29 / 6 764,29 / 4 509,52, summing to 47 350,00. §7 hens fixture: 81 000,00.
- [ ] Property: for any asset (random cost, residual, life, in-service and disposal days), the charges sum to the base, and none is negative. An asset in the opening balance spreads what is left over the months left.
- [ ] Each acquisition method posts the FC1 entry; an asset in the opening balance posts nothing (domain + integration).
- [ ] The life is required and > 0; no life is prefilled. Land has no life and is never depreciated.
- [ ] Disposing of §7.1 A's generator on 15 Mar 2028 (2 months used in 2028):
  - posts the 2028 depreciation, cumulative(18) − cumulative(16) = 1 014 643 − 901 905 centimes = 1 127,38 (D 6193 / C 28xx);
  - then D 28xx 10 146,43, D the disposed net book value account (candidate 6513) 37 203,57 / C asset account 47 350,00;
  - and the price on the disposal proceeds account (candidate 7513).
- [ ] Owner only for writes; tenant isolation (integration).
**Depends on:** T100.
**Size:** M

### T103: The close run, depreciation first (FCX4, FC1)
**Blocked by:** T100, through T102.
**Description:** "Préparer la clôture" (`/closing`, owner): computes the year-end entries, shows them, then posts them (OD, the year's last day, source `close:<kind>:<entity>:<year>`, FN7 versions). Depreciation is its first kind: D 6193 / C 28xx per account, without the months a disposal already posted. Later tasks add their kinds to the same run.
**AC:**
- [ ] §7.1 A's 2026 run posts D 6193 / C 28xx 2 254,76 on 31 Dec 2026.
- [ ] A second run with the same facts posts nothing; a changed life posts a reversal and a new entry (integration).
- [ ] The run is refused while the year's last month is locked, and for a `cash_book` entity.
- [ ] Once the run has posted, the year's count (T107) can no longer be changed (integration).
- [ ] Owner only; the manager and the accountant see the preview, workers are refused (integration).
**Depends on:** T102, T107.
**Size:** M

### T104: Year close and opening reversals (FCX5, FCX6)
**Blocked by:** T100, through T103.
**Description:** "Clôturer l'exercice" (owner):
- locks every month of the year (FN5) and records `FiscalYearClose` (who, when);
- posts the next year's à-nouveaux through `openFiscalYear`, with the reversals of the reversible close kinds dated the next year's first day;
- when a close entry changes after the next year is open, posts the à-nouveaux and the reversals again by reversal and new entry;
- reopening (owner, audited) unlocks the last month;
- T110's view and the statements say "Exercice clôturé le …" once closed.
**AC:**
- [ ] After the close, the à-nouveaux equals the closing classes 1–5 plus the result on 1191 / 1199. After a later change to a close entry, it still does (integration).
- [ ] The reversal of a reversible kind is posted once on the next year's first day; a second close posts nothing.
- [ ] Trial balance balanced after close and opening (property test over T103's runs).
- [ ] Owner only; the manager and the accountant see the status (integration).
**Depends on:** T103, T110.
**Size:** M

### T105: Loans (FC2: schedule, payments, reminders)
**Blocked by:** T100 (1481, 6311).
**Description:**
- `Loan` and `LoanInstallment`, finance's own tables.
- Pure `loanSchedule`: rate as an integer in 1/100 000, monthly or quarterly, deferral, due days clamped to the month's end (default FQ16).
- "Emprunts et subventions" screen: the owner creates the loan, adjusts rows to the bank's table, confirms. The owner or a manager marks an installment paid.
- Postings: disbursement D 5141 / C 1481; installment D 1481 + D 6311 / C 5141, `BQ`.
- A reminder on the due day (money notification, once). The `/treasury` cash schedule counts unpaid installments.
**AC:**
- [ ] §7.1 B to the centime (6 rows, interest 4 856,25); §7 900 000 / 28 fixture: 32 142,86, last 32 142,78, 9th interest 8 919,64.
- [ ] Property: capital always sums to the principal. Editing rows so it doesn't refuses the confirmation.
- [ ] Marking an installment paid twice posts once; a confirmed schedule can't be edited (integration).
- [ ] The reminder is sent once to owners and managers, never to workers or the accountant (integration).
- [ ] Works for a `cash_book` entity: the installment shows in its cash book.
**Depends on:** T100.
**Size:** M

### T106: Investment subsidies (FC2)
**Blocked by:** T100 (1311, 7577, the subsidy contra-account candidate), through T103.
**Description:** `Subsidy` (amount, day received, bank account, financed assets). Posted when received, D 5141 / C 1311 (default FQ17). The close run releases it to C 7577, debiting the equity contra account confirmed by T100 (candidate 1319), in proportion to the cumulative depreciation of its assets (cumulative rounding). Shown with the loans.
**AC:**
- [ ] §7.1 A subsidy: 676,43 in 2026, 2 029,29 in 2027; the releases over the assets' life sum to the subsidy (property).
- [ ] A subsidy on land only, or on no asset, is refused (FQ17).
- [ ] Rerunning the close with the same facts posts nothing (integration).
**Depends on:** T103 (and T105 for the screen).
**Size:** S

### T108: Stocks at close (FC5, bought stock)
**Blocked by:** T100 (31x by kind, 6124, 6196, and the provision and reversal candidates).
**Description:** The close run's "stocks" kind: per item and farm, counted (else book) quantity × weighted average cost on the last day (`inventory.valuate`), D 31x / C 6124 by kind. An optional lower current value per line (default FQ20: cost), with a provision D 6196 / C the materials-and-supplies provision account (candidate 3912). Both reversed by T104.
**AC:**
- [ ] §7 `stockAtCloseValue`: 98 400 vs 97 300 → 97 300, provision 1 100,00.
- [ ] Valued at the cost on the last day: a purchase on the 2nd of January doesn't change it (integration).
- [ ] With PCA off, each 31x line lands on its CGNC fallback (FQ1).
**Depends on:** T107, T104.
**Size:** M

### T109: Batches in progress (FC4)
**Blocked by:** T100 (31322, 7131, 6196, 3913, and the reversal candidate).
**Description:** The close run's "batches in progress" kind for meat batches open on the last day.
- Cost engaged from FN13 as of the last day: `batchResults` gains an as-of day, and only facts dated on or before it count.
- Split by head (default FQ19).
- Current value suggested from the last weighing and the last sale price (default FQ20), or typed by the owner.
- D 31322 / C 7131, and the provision D 6196 / C 3913. Reversed by T104.
**AC:**
- [ ] §7.1 C: 144 400,00 at cost, current value 135 660,00, provision 8 740,00, and its reversal on 1 Jan.
- [ ] A batch with no weighing or no sale requires a typed value before the run posts.
- [ ] Pullet and layer batches are listed "non valorisés (FQ7)", not valued (until T114 / T115).
- [ ] `/results` figures for closed batches are unchanged by the as-of day (existing tests green).
**Depends on:** T107, T104.
**Size:** M

### T112: Home consumption (FC7)
**Blocked by:** T100 (7140 must be confirmed in the PCA text; if it isn't there, FQ21). An individual's entry also waits for FQ11.
**Description:** The three sale forms (V2, V6, V7) get the kind "Consommation", with who took the birds or eggs (exploitant, associate, employee).
- It has no buyer and no payment. The withdrawal blocks, birds on hand and the FIFO egg draws apply as for a sale.
- The price is prefilled from the last sale of the same product (default FQ21).
- `sales` changes its record and change log; finance posts it in `OD`: D 4463 / 6171 / C 7140.
**AC:**
- [ ] Recorded offline, synced once, birds on hand lowered; refused during a withdrawal (Playwright offline + integration).
- [ ] An associate's posts D 4463 / C 7140; an employee's D 6171 / C 7140; an individual exploitant's posts nothing and is listed "non comptabilisé (FQ11)".
- [ ] Counted in the batch's sales and kg sold (`batchResults` test).
- [ ] Workers record quantities but never see the price (stripped on pull, integration).
**Depends on:** T100.
**Size:** M

### T119: Bank fees category (FC9)
**Blocked by:** T100 (the bank services account, candidate 6147).
**Description:** New quick-expense category "Frais bancaires" in `EXPENSE_ACCOUNTS`, paid from the bank: D bank services account / C 5141, `BQ`. It lets a statement with fees reach "rapproché" on T111's screen.
**AC:**
- [ ] "Frais bancaires" posts on the confirmed account and shows on `/settings/chart` (operations test).
- [ ] A statement with a fee line reaches difference 0 once the fee is booked (integration, T111's fixture plus a fee).
**Depends on:** T100, T111.
**Size:** S

### T113: Eggs at close (FC5, eggs)
**Blocked by:** the owner's OK to add `eggs` to finance's dependencies (CAPABILITY-MAP; "ask first", SPEC §7), and T100 (the own-products 31x account, 7132). Default FQ18 decided (value per egg typed by the owner).
**Description:** Egg stock (SPEC-m3 E2) on the count sheet with its book quantity. The close run values counted eggs × the typed value: D own-products 31x / C 7132, reversed by T104.
**AC (when unblocked):**
- [ ] Eggs on the count sheet match `eggs` stock on the last day; the value is required before the run posts.
**Depends on:** T108. **Size:** S

### T114: Laying hens, simplified method (FC6)
**Blocked by:** FQ7 (no safe default: choosing the method is the accountant's), and T100 (715 and the valuation basis, read from the PCA text).
**Description:** The method choice per category in the accounting settings (locked once the year has an entry, like FN1). The close run values the laying flock per the PCA text, through 715.
**Size:** M

### T115: Laying hens and pullets, classic method (FC6)
**Blocked by:** FQ7 and FQ8 (removing culled hens' remaining book value: no safe default), and T100 (23962, 71431, 23711, 28371, 7187).
**Description:**
- Own pullets capitalised: D 23962 / C 71431, at the transfer to lay and at year end.
- Point-of-lay hens bought: D 23711.
- Depreciation over the laying period (life and cull value typed by the owner): D 6193 / C 28371.
- Culled hens sold: C 7187.
- The removal entry, per FQ8's answer.
**Size:** L

### T116: Official statements (FC8)
**Blocked by:** FQ22 (the official simplified model and its line ↔ account mapping, the PCA biological-asset tables, the revenue limit).
**Description:** Bilan, CPC and ETIC in the simplified CGNC model, printable PDF, "Projet" until the year close.
**Size:** L

### T117: Bank statement import (FC9)
**Blocked by:** real statement files from the pilot's banks. No format is assumed.
**Description:** One importer per bank, with sample files as fixtures, feeding T111's matching.
**Size:** M per bank

### T118: Accountant import format (FC10)
**Blocked by:** FQ10 (the firm's software, its import format and a sample file).
**Description:** One export per software next to FN18's CSV and Excel.
**Size:** M per format

## ✅ Checkpoint M6
- [ ] The PCA PDF is in the repository (or its download is allowed) and T100 is done: every candidate account is confirmed or replaced.
- [ ] An expert-comptable has reviewed the T100 accounts and the FC posting rules, and answered or accepted the defaults above (FQ9, FQ16–FQ21).
- [ ] A pilot company closes a fiscal year in Dawra (count, close run, draft statements) and the accountant explains every difference with their own closing.
- [ ] SPEC-finance §8 "Accounting close, end of M6" criteria met.
