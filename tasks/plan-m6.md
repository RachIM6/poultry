# Implementation plan: M6 accounting close

_v0.1, 20 Nov 2026. Status: **draft**. Implements [SPEC-finance.md](../SPEC-finance.md) §5 (FCX1–FCX6, FC1–FC10) under [ADR-010](../docs/decisions/ADR-010-accounting-model.md). Module: `finance` (strict), plus small changes in `sales` (FC7). Task numbers T100–T119 (T90–T99 are M5)._

Definition of done, file layout and verification commands are the same as [todo.md](todo.md). Every money function gets its SPEC-finance §7 or §7.1 fixture as its first test. Each task goes domain test → integration test (tenant isolation, roles: worker nothing, accountant read-only, owner-only actions) → screen → Playwright spec, then lint, typecheck, `pnpm test` and the spec. M6 screens are online, server-rendered like `/books`, and linked from "Plus" › Argent. Nothing new goes on `/batches` (JS budget). All strings go in `fr.json` and `ar.json` (FX5).

**Most of M6 waits for T100.** Almost every FC rule posts to an account that wasn't seeded. T100 seeds the PCA nomenclature from the official text, now in `docs/sources/plan-comptable-agricole-2015.pdf`. Before it, only T107, T110 and T111 could be built: they post nothing, or only to accounts already seeded.

## Defaults taken without asking (SPEC-finance §5, to confirm with the accountant)

| Question | Default | Where |
|---|---|---|
| FQ9 prorata | By whole months: the in-service month counts in full, the disposal month doesn't; cumulative rounding | FC1, T102 |
| FQ27 `cash_book` assets | The register and the schedules only (FCX4): nothing posted, no payment of a debt | FC1, T102 |
| FQ16 loans | Interest per period = annual rate ÷ periods per year; no accrued interest at year end (manual entry if wanted) | FC2, T105 |
| FQ17 subsidies | Booked when received (D 5141 / C 1311); released to 7577 in proportion to the assets' depreciation, through 1319 Subventions d’investissement inscrites au compte de produits et charges (confirmed by T100); refused on land | FC2, T106 |
| FQ18 eggs | Value per egg typed by the owner | FC5, T113 |
| FQ19 batch in progress | FN13's cost only, split by head between birds on hand and birds sold | FC4, T109 |
| FQ20 current value | Last weighing × last sale price for a batch; cost for a stock unless the owner lowers it | FC4, FC5, T108, T109 |
| FQ21 home consumption | Prefilled with the last sale price; an employee's share on 6171 | FC7, T112 |
| NQ7 accountant writes | The accountant approves outside the app; the owner closes the year | FCX6, T104 |
| Close entries | Reversed on the next year's first day, provisions included | FCX5, T104 |

No life, rate, tax rate, price or bank file format is stored or suggested anywhere: the user types lives and rates from the contract or the accountant.

**Candidate accounts** (SPEC-finance §5 "Candidates"): numbers that were neither seeded nor in the original M6 summary. T100 confirmed each from the PCA nomenclature:

| Role | Candidate | Confirmed, printed label |
|---|---|---|
| Debts on fixed-asset acquisitions | 4481 | 4481 Dettes sur acquisition d’immobilisations (1486 vs 4481: FQ23) |
| Net book value of tangible assets disposed of | 6513 | 6513 VNA des immobilisations corporelles cédées |
| Proceeds of tangible-asset disposals | 7513 | 7513 Produits des cessions des immobilisations corporelles |
| Subsidy amounts taken to income | 1319 | 1319 Subventions d’investissement inscrites au compte de produits et charges |
| Provision on materials and supplies | 3912 | 3912 Provisions pour dépréciation des matières et fournitures |
| Reversals of current-asset provisions | 7196 | 7196 Reprises sur provisions pour dépréciation de l’actif circulant |
| Bank services | 6147 | 6147 Services bancaires |
| Furniture and office equipment | 235x | 2351 Mobilier de bureau, 2352 Matériel de bureau, 2355 Matériel informatique, 2358 Autres mobilier, matériel de bureau et aménagements divers; depreciation 2835 |

The asset, stock and hens families are in SPEC-finance §5 "Accounts from the PCA nomenclature".

## Dependency graph

```
Buildable now (no new account)
T107 count sheet
T110 draft balance sheet
T111 bank reconciliation, manual matching

Blocked
T100 close accounts         ← the PCA PDF, now in docs/sources/
 ├── T101 manual entry + opening balances
 ├── T102 assets + depreciation ── T103 close run ── T104 year close + opening reversals
 │                                   ├── T106 subsidies (screen with T105)
 │                                   └── with T104, T107: T108 stocks at close, T109 batches in progress
 ├── T105 loans
 ├── T112 home consumption   (an individual's entry also ← FQ11)
 └── T119 bank fees category (after T111)
T113 eggs at close           ← unblocked 22 Nov 2026 (finance → eggs approved); after T108
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
- [x] The sheet lists every open batch and stock item of the farm on the last day; no price or value appears in its HTML (Playwright, print media). _`e2e/count.spec.ts` "the year-end count sheet lists every open batch and stock item, prints without an amount, and shows the gaps"; the day rules in `finance/domain/count.test.ts`._
- [x] Counted quantities save once and can be changed, audited; workers and the accountant can't write them (integration). _`finance/count.int.test.ts` "saves the counted quantities once, changes them, audited; owner and manager only, each organisation its own"._
- [x] Finance writes nothing into `inventory` or `flock` (the count only reads their `index.ts`; lint boundary rule green). _Reads `flock.batchesForFinance` (now with the production type) and the new `inventory.stockOnDay`; the same integration test checks their row counts are unchanged; `pnpm lint` green._
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
- [x] With a two-week fixture whose statement lines are all in the books, ticking them brings the difference to 0 (integration). (`bank.int.test.ts` "two-week fixture: ticking the statement's lines, all in the books, brings the difference to 0"; domain: `domain/bank.test.ts` "two-week fixture: …"; browser: `e2e/bank.spec.ts`.)
- [x] A line is ticked on one statement at most; unticking is refused once its month is locked; ticks are audited. (`bank.int.test.ts` "ticks a line on one statement at most, in the database too, and only up to the end day" and "refuses ticking and unticking once the line's month is locked, and audits every tick"; key on `BankMatch.journalLineId`.)
- [x] Owner and manager write; accountant reads; worker refused. (`bank.int.test.ts` "lets the owner and a manager write, the accountant read, and refuses workers and other organisations".)
**Depends on:** nothing. **Blocked by:** none.
**Size:** M

## Blocked

### T100: Close accounts from the PCA nomenclature (FCX3, FC1–FC9)
**Blocked by:** nothing now. The official text that `accounts.json` cites (finances.gov.ma/Publication/depp/2017/Plan Comptable Agricole -vf-dec2015.pdf) is in `docs/sources/plan-comptable-agricole-2015.pdf`. No CGNC nomenclature is available: `pca` tags come from the PCA text and the accounts' agricultural nature, and the doubtful ones are listed in SPEC-finance §9 "Found for the accountant (T100)".
**Description:** Seed the whole nomenclature of the PCA text (classes 1–8, labels as printed) into `prisma/seed/finance/accounts.json`, so manual entries and opening balances can use any account.
- **Charts:** accounts the PCA adds to the CGNC are tagged `pca`, with their CGNC `fallback` (FN2, FQ1).
- **Families:** resolve the numbers §5 leaves open: the asset accounts in 231x–234x and their 28xx; the 31x accounts by stock kind and for the farm's own products; and, for T114, what the text says about the simplified hens method (715).
- **Candidates:** confirm or replace each candidate in the table above.
**AC:**
- [x] Every account SPEC-finance §5 names exists in the seed with its printed label (unit test listing them). An account the text lacks is listed under "Found for the accountant", and its rule stays out: no number invented. _`finance/accounts.test.ts` "has every account SPEC-finance §5 names, with its printed label (T100)"; every §5 account is in the text. **In part for "the whole nomenclature":** 762 accounts seeded (692 new), minus 14 printed rows left out (the sub-accounts of 3421, 3424, 4411 and 6136, two of them misprints), listed in SPEC-finance §9 with FQ24._
- [x] Each candidate (4481, 6513, 7513, 1319, 3912, 7196, 6147, 235x) is confirmed or replaced from the text, with its printed label, and SPEC-finance §5 is updated to the confirmed number before any rule using it is coded. _All confirmed (table above); 235x is 2351–2358._
- [x] Every account a posting rule uses (`POSTED_ACCOUNTS`, `EXPENSE_ACCOUNTS`) is still a posting account (no sub-account under it) in both charts (`chart.test.ts`, `operations.test.ts` green). If the import gives one of them children, stop and report. _The import gave 3421, 3424, 4411 and 6136 children: reported, and their sub-accounts left out. `finance/accounts.test.ts` (the chart tests) "keeps every account a posting rule uses a posting account, in both charts"; `domain/operations.test.ts` green._
- [x] `pnpm db:seed` upserts over a database with posted entries; their lines keep their accounts (integration). _`finance/seed.int.test.ts` runs the seed script twice over posted entries, then reverses each one (FN4 re-checks the lines)._
- [x] Roll-up of each new PCA account reaches its class through `parentNumber`. _`finance/accounts.test.ts` "is a tree: every parent exists in the same charts, every account reaches its class", over every seeded account._
**Depends on:** nothing.
**Size:** L (data from a PDF)

### T101: Manual entries and opening balances (FCX3, FN3)
**Blocked by:** T100 (opening balances need class 1–5 accounts that aren't seeded).
**Description:** "Écriture manuelle" on `/books` for the owner: day, label, piece reference, optional receipt (ADR-011), lines on any posting account of the entity's chart, live Σdebit − Σcredit. Posted through `postEntry` (OD, source `finance:<id>`). The first year's opening entry is the same form, dated the year's first day.
**AC:**
- [x] A balanced entry on any leaf account posts once (same id twice → one entry), audited. Unbalanced, one-line and parent-account entries are refused (FN4). _`finance/manual.int.test.ts` "posts a balanced entry on any leaf account once (OD, source finance:<id>), audited" and "refuses unbalanced, one-line and parent-account entries (FN4)" (2321 Bâtiments, which has sub-accounts). The piece reference and the receipt live in a new `ManualEntry` row (migration `manual_entry`): `JournalEntry` has no piece column and its immutability trigger forbids attaching a receipt after posting._
- [x] Manager, accountant and worker are refused (integration). The accountant sees the entries on `/books`. _`finance/manual.int.test.ts` "is the owner's: manager, accountant and worker are refused; the accountant reads the entry on /books" (`readBooks` as the accountant: the OD entry with its piece, and the trial balance)._
- [x] An entry in a locked month is refused with the reason. It isn't moved: a manual entry is dated by its author. _`finance/manual.int.test.ts` "refuses an entry in a locked month with the reason, and doesn't move it": `PERIOD_LOCKED` (`errors.PERIOD_LOCKED` on the form), nothing posted in any month._
- [x] A `cash_book` entity sees the form disabled with the FQ11 reason. _`e2e/books.spec.ts` (the cash-book farmer: reason shown, button disabled); the server refuses too, `CASH_BOOK_NO_MANUAL_ENTRY` (`finance/manual.int.test.ts`)._
- [x] Playwright: the owner types a three-line opening entry, it shows in the journal and the trial balance. _`e2e/manual-entry.spec.ts`: 2340 and 5141 against 1111 on 1 January, with the live Σdebit − Σcredit and a receipt; journal (piece, receipt link) and balanced trial balance._
**Depends on:** T100.
**Size:** M

### T102: Fixed-asset register and depreciation schedule (FC1)
**Blocked by:** T100 (asset accounts 231x–235x, 2832–2835, 6193, 4481, 6513, 7513).
**Description:**
- `FixedAsset`, finance's own table: legal entity, label, category, farm and house, acquired and in-service days, cost, VAT, residual value, life in months, payment method, `inOpeningBalance` and its accumulated depreciation, disposal day and price, receipt.
- Pure `straightLine`: cumulative rounding, default prorata FQ9.
- "Immobilisations" screen: each asset's schedule by year. The owner writes; the manager and the accountant read.
- **Postings:**
  - acquisition: D asset account (+ 3455 when VAT-registered) / C 5161, 5141, or 4481 Dettes sur acquisition d’immobilisations;
  - a later payment of an asset bought on credit: D that account / C 5161 or 5141;
  - disposal (§5 FC1), with the year's depreciation up to it.
- **Category → account:** a map in `domain/`, like `EXPENSE_ACCOUNTS`, filled from T100's confirmed numbers.
- **`cash_book` entity** (FCX4): the register and the schedules only, nothing posted and no payment of a debt; where its cash or bank payment for an asset goes in the cash book is FQ27 (SPEC-finance §9).
**AC:**
- [x] §7.1 A: 2 254,76 / 6 764,29 / 6 764,28 / 6 764,29 / 6 764,28 / 6 764,29 / 6 764,29 / 4 509,52, summing to 47 350,00. §7 hens fixture: 81 000,00. _`finance/domain/assets.test.ts` "§7.1 A: whole months from September, rounded once per cumulative figure, adding up to 47 350,00" and "§7: hens 252 000 − 90 000 over 14 months, 7 months in the year → 81 000,00" (`straightLine`, bigint, half up once per cumulative figure). The same schedule on the "Immobilisations" screen: `e2e/assets.spec.ts`._
- [x] Property: for any asset (random cost, residual, life, in-service and disposal days), the charges sum to the base, and none is negative. An asset in the opening balance spreads what is left over the months left. _`finance/domain/assets.test.ts` "adds up to the base for any cost, residual, life, in-service and disposal days, opening balance or not": 2 000 seeded runs (fast-check isn't a devDependency, so no new one), any fiscal-year start; with a disposal, the charges sum to cumulative(months to the disposal) and the exit entry removes the asset at cost. "spreads what an asset in the opening balance has left over the months left": the remainder over the life left, the accumulated depreciation as typed._
- [x] Each acquisition method posts the FC1 entry; an asset in the opening balance posts nothing (domain + integration). _Domain: "posts each acquisition method's entry" (cash CA 5161, transfer and cheque BQ 5141, credit OD 4481) and the VAT on 3455. Integration `finance/assets.int.test.ts` "posts each acquisition method's FC1 entry once, on its day; an asset in the opening balance posts nothing" (source `finance` / `asset:<id>:acq`, the same form twice posts once) and "keeps a VAT-registered entity's VAT on 3455 and lands PCA accounts on their CGNC account with the PCA off". `FixedAsset` is finance's own table (migration `fixed_asset`); the map is `ASSET_ACCOUNTS` in `finance/domain/assets.ts`, and `accounts.test.ts` checks each of its accounts, and 4481, 6193, 6513, 7513, is a leaf in both charts. A `cash_book` entity keeps the register and the schedules only and posts nothing (one branch in `post`), and can't pay a debt (`CASH_BOOK_NO_PAYMENT`): "keeps a cash_book entity's register and schedules only: nothing posted, no debt to pay (FCX4, FQ27)", same schedule as a ledger entity's._
- [x] The life is required and > 0; no life is prefilled. Land has no life and is never depreciated. _`checkAsset` (`LIFE_REQUIRED`, `LAND_NOT_DEPRECIATED`): domain "requires a life above zero, typed; land has none", integration "requires a life above zero, never prefilled; land has none and no schedule". The form's life field starts empty and is hidden for land (`e2e/assets.spec.ts`)._
- [x] Disposing of §7.1 A's generator on 15 Mar 2028 (2 months used in 2028):
  - posts the 2028 depreciation, cumulative(18) − cumulative(16) = 1 014 643 − 901 905 centimes = 1 127,38 (D 6193 / C 2833);
  - then D 2833 10 146,43, D 6513 37 203,57 / C asset account 47 350,00;
  - and the price on 7513.

  _Domain "§7.1 A disposed of on 15 Mar 2028: …" and integration "disposes of §7.1 A's generator on 15 Mar 2028: the 2028 depreciation, the exit at cost and the price on 7513": three OD entries on the disposal day, source `asset:<id>:disposal` versions 1–3. The schedule marks the disposal year (`ScheduleYear.toDisposal`): its charge is the disposal's, so T103 leaves it out. A locked month refuses the disposal and nothing is posted._
- [x] Owner only for writes; tenant isolation (integration). _`finance/assets.int.test.ts` "is the owner's to write; the manager and the accountant read; workers and other organisations get nothing" (register, change, payment, disposal, invoice; another organisation's asset, house and bank account are `NOT_FOUND`). `e2e/assets.spec.ts`: the accountant reads without the forms, a worker is refused._
**Depends on:** T100.
**Size:** M

### T103: The close run, depreciation first (FCX4, FC1)
**Blocked by:** T100, through T102.
**Description:** "Préparer la clôture" (`/closing`, owner): computes the year-end entries, shows them, then posts them (OD, the year's last day, source `close:<kind>:<entity>:<year>`, FN7 versions). Depreciation is its first kind: D 6193 / C 2832–2835 per account, without the months a disposal already posted. Later tasks add their kinds to the same run.
**AC:**
- [x] §7.1 A's 2026 run posts D 6193 / C 2833 2 254,76 on 31 Dec 2026. _Domain `finance/domain/assets.test.ts` "§7.1 A's 2026 run: D 6193 / C 2833 2 254,76" (`yearEndDepreciation`: the year's `straightLine` charge per asset, one credit per 283x account, land and the disposal year left out); integration `finance/close.int.test.ts` "§7.1 A's 2026 run posts D 6193 / C 2833 2 254,76 on 31 Dec 2026, shown first as a preview" (OD, source `finance` / `close:depreciation:<entity>:2026` version 1, audited by `postEntry`) and "posts one credit per depreciation account with the PCA off; …". Browser: `e2e/close-run.spec.ts` (preview on `/closing`, posted, then on `/books` under 31 December 2026). The kinds are a list (`CLOSE_KINDS` in `finance/domain/close.ts`) with one computer each (`KINDS` in `finance/application/close.ts`): T106, T108 and T109 add theirs there._
- [x] A second run with the same facts posts nothing; a changed life posts a reversal and a new entry (integration). _`finance/close.int.test.ts` "posts nothing for the same facts; a changed life posts a reversal and a new version; figures now zero, the reversal alone": 84 → 60 months posts the reversal of version 1 and version 2 (3 156,67) on 31 Dec; a disposal in 2026 leaves nothing, so the run posts the reversal of version 2 and no version 3 (`closeAction`, `finance/domain/close.test.ts`). The second run in the browser says "Rien à comptabiliser : aucune écriture passée." (`e2e/close-run.spec.ts`)._
- [x] The run is refused while the year's last month is locked, and for a `cash_book` entity. _`finance/close.int.test.ts` "is refused while the year's last month is locked, and for a cash_book entity": `PERIOD_LOCKED` with December 2027 locked, nothing posted in any month; `CASH_BOOK_NO_CLOSE`, and the preview of a `cash_book` entity has no entry. A year not yet begun is refused too (`DAY_IN_FUTURE`)._
- [x] Once the run has posted, the year's count (T107) can no longer be changed (integration). _`finance/close.int.test.ts` "freezes the year's count once its run has posted": the 2027 count saves before the run and is `COUNT_FROZEN` after it, for the owner and a manager, changing or removing a line; 2028 still saves. The guard is in `saveYearEndCount`, under the legal entity's row lock that the run also takes; `/closing/count` shows "Comptage figé" and no field._
- [x] Owner only; the manager and the accountant see the preview, workers are refused (integration). _`finance/close.int.test.ts` "is the owner's to run; the manager and the accountant see the preview; workers get nothing" (`runClose` needs `finance.manage`, `closePreview` `money.read`). Browser: the accountant reads the preview without the button, a worker gets the refusal (`e2e/close-run.spec.ts`)._
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
- [x] After the close, the à-nouveaux equals the closing classes 1–5 plus the result on 1191 / 1199. After a later change to a close entry, it still does (integration). _`finance/year-close.int.test.ts` "closes 2026 once its run has posted: …" (the 12 months locked and audited, `FiscalYearClose` with who and when, migration `fiscal_year_close`; the 2027 à-nouveaux checked against the 2026 lines summed straight from the database) and "after a later change to a close entry (reopen, run, close again), posts the à-nouveaux again by reversal and new version: still equal to the closing" (84 → 60 months: the run is `PERIOD_LOCKED` and the close `CLOSE_RUN_PENDING` until the owner reopens; then the à-nouveaux version 1, its `Annulation` and version 2 on 1 January). `openFiscalYear` now goes through `postOpening`, which versions the à-nouveaux (source `opening:<entity>:<first day>`, FN7) instead of posting it once per year. Browser: `e2e/year-close.spec.ts` (run the close first, close, "Exercice clôturé le …" on `/closing` and on the bilan, the 2026 à-nouveaux in the journal on 1 January)._
- [x] The reversal of a reversible kind is posted once on the next year's first day; a second close posts nothing. _The flag is `REVERSED_AT_OPENING` in `finance/domain/close.ts` (depreciation `false`; T108 and T109 set theirs). `finance/year-close-reversal.int.test.ts` flags depreciation reversible in that file only (`vi.mock`): the reversal OD on 1 Jan 2027 (source `reversal:close:depreciation:<entity>:2026`), a second close posts nothing, and after a changed close entry the reversal is cancelled and posted again as version 2. With the real flags no reversal is posted (`year-close.int.test.ts`)._
- [x] Trial balance balanced after close and opening (property test over T103's runs). _`finance/year-close.int.test.ts` "keeps the books balanced and the opening equal to the closing over random assets, runs, closes and changes": 8 seeded organisations (no fast-check), 1–3 random assets each (category, cost, life, day in 2025–2026, cash or credit, PCA on or off), run and close 2025 then 2026, a second close posting nothing, and for about half a changed life, reopen, run and close again; after each close the trial balance of December and January and the bilan balance (`readBooks`), the opening equals the closing, and all lines sum to 0._
- [x] Owner only; the manager and the accountant see the status (integration). _`finance/year-close.int.test.ts` "is the owner's: the manager and the accountant see the status, workers nothing, each organisation its own" (`closePreview` and `readBooks` give them `closedOn`; `closeFiscalYear` and `reopenFiscalYear` are `FORBIDDEN`). Refusals: `CASH_BOOK_NO_CLOSE`, `CLOSE_RUN_PENDING`, `YEAR_NOT_ENDED`, `PREVIOUS_YEAR_OPEN`, `PERIOD_LOCKED` (the next year's first month), and on reopening `YEAR_NOT_CLOSED`, `NEXT_YEAR_CLOSED`, all before anything is written (no lock and no close row after them: checked for `CLOSE_RUN_PENDING`, `YEAR_NOT_ENDED` and `PERIOD_LOCKED`). Reopening unlocks the last month only, audited._
- [x] 2026-11-23, gap: the year opens before the previous one is closed (FN3). _"Ouvrir l'exercice N" on `/closing` (year N's page), owner only (`finance.manage`), `ledger` entities, once N has begun: `openFiscalYear(ctx, { year }, clock)` (moved to `application/close.ts`, its first caller) posts N's à-nouveaux through `postOpening` from N−1's books as they stand, with the opening reversals of the close entries already posted, each audited by `postEntry`. `closePreview` gives `opening`: `due`, `provisional` (a note for every reader, the button then "Reprendre les à-nouveaux de N−1") or null once N−1 is closed, before N begins, when N−1 has no entry. Refusals: `CASH_BOOK_NO_OPENING`, `YEAR_NOT_BEGUN`, `PERIOD_LOCKED`, `FORBIDDEN`. `finance/open-year.int.test.ts`: classes 1–5 and the result carried forward, a second click posts nothing; after more 2026 entries the close posts version 2 over the early one (one live opening, the reversal once); after a reopen, a click posts version 3 only because the figures changed; cash_book, a year not begun and the manager, accountant and worker refused with nothing written._
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
- [x] §7.1 B to the centime (6 rows, interest 4 856,25); §7 900 000 / 28 fixture: 32 142,86, last 32 142,78, 9th interest 8 919,64. _Domain `finance/domain/loans.test.ts` "§7.1 B to the centime: 6 rows, the 31st clamped to the month's end, interest 4 856,25" and "§7: 900 000 over 28 quarters → 32 142,86, the last 32 142,78; the 9th quarter's interest 8 919,64" (`loanSchedule`, bigint, half up; also the deferral, monthly periods and due days clamped from the first one). Integration `finance/loans.int.test.ts` "§7.1 B: the draft schedule to the centime; once confirmed, the disbursement D 5141 / C 1481 on its day, once" (rows stored, outstanding before each row, interest 4 856,25 on the register). `Loan` and `LoanInstallment` are finance's own tables (migration `loan`). Browser: `e2e/loans.spec.ts` (the rows and the totals 4 856,25 / 100 000,00 / 104 856,25)._
- [x] Property: capital always sums to the principal. Editing rows so it doesn't refuses the confirmation. _`finance/domain/loans.test.ts` "adds the capital up to the principal for any loan; an edit that doesn't is refused": 2 000 seeded runs (no fast-check), any principal, rate, frequency, n, deferral and first due day; one centime of capital moved off any row is `CAPITAL_NOT_PRINCIPAL`, moved to another row confirms. Integration "refuses a confirmation whose capital doesn't add up to the principal; rows adjusted to the bank's table confirm": the draft saves (`saveLoanSchedule`), `confirmLoan` refuses, nothing posted; adjusted rows (capital and interest) confirm and are kept. Browser: the refusal, then the confirmation (`e2e/loans.spec.ts`)._
- [x] Marking an installment paid twice posts once; a confirmed schedule can't be edited (integration). _`finance/loans.int.test.ts` "marking an installment paid twice posts once, on the day entered, on or after its due day; a confirmed schedule can't be edited": D 1481 16 666,67, D 6311 1 387,50 / C 5141 18 054,17 (`BQ`, the bank account's tag), source `finance` / `loan:<id>:installment:1`; the owner then a manager mark it, one entry. `LOAN_CONFIRMED` for the rows and for discarding; `BEFORE_DUE_DAY`, `DAY_IN_FUTURE`; a locked month refuses with `PERIOD_LOCKED`, nothing posted and the row unpaid. Roles: "is the owner's to write; a manager marks installments paid; the accountant reads; workers and other organisations get nothing". PCA off: the same 5141, 1481 and 6311. A loan in the opening balance posts no disbursement, its installments post. The `/treasury` cash schedule counts the unpaid installments of confirmed loans (`cashForecast`, overdue ones in the first week; not a draft's, not a paid one)._
- [x] The reminder is sent once to owners and managers, never to workers or the accountant (integration). _`finance/loans.int.test.ts` "announces each installment once on its due day to owners and managers, never to workers or the accountant; not a draft's, not a paid one": `sendLoanReminders` (called by `/api/push/dispatch`) claims the rows with `remindedAt`, template `loanDue`, a money notification (`MONEY_TEMPLATES`: never synced to someone who can't see money)._
- [x] Works for a `cash_book` entity: the installment shows in its cash book. _`finance/loans.int.test.ts` "works for a cash_book entity: the disbursement and the installment show in its cash book" (`readBooks`: 100 000,00 in on 5141 in January, 18 054,17 out against 1481 and 6311 in March). Unlike an asset's (FCX4, FQ27), a loan's entries are posted for a `cash_book` entity: the money moves on its bank account. Browser: `e2e/loans.spec.ts` (an individual farmer: the installment in "Recettes et dépenses")._

  _Defaults: the owner types the disbursement day and the bank account; a payment is marked on the day the bank debited it (default the due day, on or after it), for the whole installment only (partial payments are out of scope); no accrued-interest close kind (FCX3: a manual entry). The spec doesn't cover a loan taken before Dawra: "in the opening balance" leaves out the disbursement day, the principal being the capital still owed, nothing posted until its installments (as T102 did for assets). A draft can be discarded; a confirmed loan can't._
**Depends on:** T100.
**Size:** M

### T106: Investment subsidies (FC2)
**Blocked by:** T100 (1311, 7577, 1319), through T103.
**Description:** `Subsidy` (amount, day received, bank account, financed assets). Posted when received, D 5141 / C 1311 (default FQ17). The close run releases it to C 7577, debiting 1319, in proportion to the cumulative depreciation of its assets (cumulative rounding). Shown with the loans.
**AC:**
- [x] §7.1 A subsidy: 676,43 in 2026, 2 029,29 in 2027; the releases over the assets' life sum to the subsidy (property). _Domain `finance/domain/subsidies.test.ts` "§7.1 A: 676,43 in 2026, 2 029,29 in 2027, rounded once per cumulative figure" (`subsidyRelease`: subsidy × Σ cumulative depreciation from `straightLine` ÷ Σ depreciable bases, half up once per cumulative figure, bigint; the whole schedule 2026–2033 ends at 14 205,00) and "adds the releases up to the subsidy for any assets, receipt day and fiscal year": 1 000 seeded runs (no fast-check), 1–3 assets each (category, cost, residual, life, in-service day, opening balance or not), any receipt day and fiscal-year start; no release below zero, and the close run's entry is the year's release. Integration `finance/subsidies.int.test.ts` "§7.1 A: posts the receipt D 5141 / C 1311 on its day, once; the close run releases 676,43 in 2026 and 2 029,29 in 2027, D 1319 / C 7577" (receipt `BQ`, source `finance` / `subsidy:<id>:receipt`, the bank account on the 5141 line; the close kind `subsidy`, source `close:subsidy:<entity>:<year>`, OD on 31 December). `Subsidy` and `SubsidyAsset` are finance's own tables (migration `subsidy`); `CLOSE_KINDS` and `KINDS` have the `subsidy` kind, `REVERSED_AT_OPENING` false; `accounts.test.ts` checks 1311, 1319 and 7577 are leaves in both charts, and the PCA-off organisation lands on the same accounts. Browser: `e2e/subsidies.spec.ts` (the owner records the subsidy on "Emprunts et subventions", reads its release by year, sees D 1319 / C 7577 676,43 in the `/closing` preview, posts it, finds it in the journal on 31 December; the accountant reads without the form, a worker is refused). A year releases nothing before the subsidy is received; the year it is received catches up with the depreciation so far. A disposed asset's release stops with its depreciation; the rest stays on 1311 / 1319 (FQ28)._
- [x] A subsidy on land only, or on no asset, is refused (FQ17). _Domain "refuses a subsidy on land, or on no depreciable asset (FQ17)" (`checkSubsidy`: `SUBSIDY_ON_LAND`, also with land and another asset, since land is never depreciated and its share would never be released; `SUBSIDY_NO_ASSET` for no asset or a depreciable base of 0). Integration "refuses a subsidy on land only, on land and another asset, or on no asset (FQ17); nothing is posted or kept", with a cash box, a day not yet come, a locked month and another organisation's asset or bank account refused before anything is written. The form offers only the depreciable assets still in service._
- [x] Rerunning the close with the same facts posts nothing (integration). _`finance/subsidies.int.test.ts` "posts nothing when the close runs again with the same facts; a changed life posts a reversal and a new release": 2026 and 2027 run again post 0 and the preview says `unchanged`; 84 → 60 months posts the reversal and version 2 of both kinds (subsidy release 94 700 = 0,3 × 315 667), and a run after it nothing. Roles: "is the owner's to write; the manager and the accountant read; workers and other organisations get nothing". A `cash_book` entity (FCX4, as T105): "works for a cash_book entity: the receipt shows in its cash book; no release, since it has no close run" (`readBooks`: 14 205,00 in on 5141 against 1311; `CASH_BOOK_NO_CLOSE`; the release by year is shown, not posted)._
**Depends on:** T103 (and T105 for the screen).
**Size:** S

### T108: Stocks at close (FC5, bought stock)
**Blocked by:** T100 (31x by kind, the 6124 leaves, 6196, 3912, 7196).
**Description:** The close run's "stocks" kind: per item and farm, counted (else book) quantity × weighted average cost on the last day (`inventory.valuate`), D 31x / C the matching 6124 leaf by kind (612412, 61242 or 61243, never 6124 itself, which has sub-accounts: SPEC-finance §5 "Bought stock by kind"). An optional lower current value per line (default FQ20: cost), with a provision D 6196 / C 3912. Both reversed by T104.
**AC:**
- [x] §7 `stockAtCloseValue`: 98 400 vs 97 300 → 97 300, provision 1 100,00. _Domain `finance/domain/stocks.test.ts` "§7 stockAtCloseValue: 98 400 vs 97 300 → 97 300, provision 1 100,00; at cost without a lower current value" (min(cost, current value), never above cost) and "values the counted quantity, else the book one, at the day's average cost, half up" (`stocksAtClose`: counted (else book) quantity × the item's value ÷ its book quantity on the day, bigint; an item never bought, or with nothing left, not valued). Integration `finance/stocks.int.test.ts` "§7 stockAtCloseValue: 98 400,00 at cost, the owner's 97 300,00, a provision of 1 100,00": 20 t bought at 4,80 and 5,04, the owner types 97 300 (`saveYearEndValues`), the run posts D 3121 / C 612412 98 400,00 (kind `stock`, source `close:stock:<entity>:2026`, label "Stocks de fin d’exercice") and D 6196 / C 3912 1 100,00 (kind `provision`, `close:provision:<entity>:2026`), OD on 31 December; the litter found with no purchase cost is listed in the preview, not valued. The owner's value is `YearEndValue` (finance's own table, migration `year_end_value`), owner only, audited, refused (`COUNT_FROZEN`) once the run has posted, like the count. Browser: `e2e/stocks-at-close.spec.ts` (the count, the preview's stock line at 98 400,00, the owner's 97 300 on `/closing`, the provision 1 100,00, both posted and found in the journal on 31 December; the accountant reads without the field)._
- [x] Valued at the cost on the last day: a purchase on the 2nd of January doesn't change it (integration). _`finance/stocks.int.test.ts`: the 2 January 2027 purchase at 6,00 is left out of 2026 (`inventory.stockValueOnDay`: `valuate` over the movements up to the day only), and 2027's preview counts it at its own average (158 400,00), without the 2026 value._
- [x] With PCA off, each 31x line lands on its CGNC fallback (FQ1). _`finance/stocks.int.test.ts` "with the PCA off, lands each 31x line on its CGNC account": D 3121, 31221, 31223 / C 61241 (612412's fallback, a leaf in the CGNC chart), 61242. `accounts.test.ts` "posts bought stock by kind to the purchase's family, on a 6124 leaf, and on CGNC leaves with the PCA off" checks, from the seeded charts, that each kind's stock account follows its purchase account's family (6121 → 3121 / 61241x, 6122 → 3122x / 61242) in both charts, and that 3121, 31221, 31223, 612412, 61242, 6196, 3912 and 7196 are posting accounts in both._
- [x] Reversed on the next year's first day by T104's year close; rerunning the close with the same facts posts nothing (integration). _`REVERSED_AT_OPENING` is true for `stock` and `provision`. `finance/stocks.int.test.ts` "reverses the stock entry and the provision on the next year's first day with the year close (FCX5)": on 1 Jan 2027, D 612412 / C 3121 98 400,00 and D 3912 / C 7196 1 100,00 (`openingReversalOf`: a provision is taken back on 7196, FC5, not credited to 6196), with the à-nouveaux carrying 3121 and 3912; a second close posts nothing. A second run of the 2026 close posts 0 and the preview says `unchanged`._
- [x] Browser: a stock item with a purchase, the count, the close preview showing the stock line, posting. _`e2e/stocks-at-close.spec.ts`, also in Arabic (RTL, the page doesn't scroll sideways)._

  _Defaults: the owner types the current value of a whole line, in dirhams, on `/closing` next to the stock entry (not on the printed count sheet, which carries no amount); a value above cost leaves the line at cost. FCX4's "provisions" is its own kind, `provision`, one entry for every provision: T109 adds its D 6196 / C 3913 lines there. A VAT-registered entity's stock is valued without the purchases' VAT, as its charges were (FN9, as `assetCost`). Without the PCA a vaccine or a medicine is bought on 6122 (612123's fallback), so its stock follows that family: 31221 / 61242, not 3121 (§5's table is the PCA's). Inventory has no packaging kind, so FQ26 doesn't arise yet._
**Depends on:** T107, T104.
**Size:** M

### T109: Batches in progress (FC4)
**Blocked by:** T100 (31322, 7131, 6196, 3913, 7196).
**Description:** The close run's "batches in progress" kind for meat batches open on the last day.
- Cost engaged from FN13 as of the last day: `batchResults` gains an as-of day, and only facts dated on or before it count.
- Split by head (default FQ19).
- Current value suggested from the last weighing and the last sale price (default FQ20), or typed by the owner.
- D 31322 / C 7131, and the provision D 6196 / C 3913. Reversed by T104.
**AC:**
- [x] §7.1 C: 144 400,00 at cost, current value 135 660,00, provision 8 740,00, and its reversal on 1 Jan. _Domain `finance/domain/stocks.test.ts` "§7.1 C: 144 400,00 at cost, current value 135 660,00, provision 8 740,00; reversed on 1 January" (`batchInProgressValue`: cost engaged × on hand ÷ (on hand + sold), half up; `suggestedValue`: on hand × the last weighing's total ÷ its count × the price per kg, half up once, or × the last price per head; `yearEndBatches` D 31322 / C 7131; `yearEndProvision` takes the batches' lines too: one entry, D 6196 / C 3912 and C 3913) and "one provision entry for the stocks and the batches". Integration `finance/batches-at-close.int.test.ts` (fiscal year 2025, since flock refuses a day not yet come): 10 000 chicks at 6,00, 25 t of feed eaten at 4,80, 2 400,00 of vet fees, 2 000 sold at 8,50 DH/kg, 400 dead, weighed at 2 100 g, 7 600 counted; a death, a feed draw, vet fees, a weighing and a sale in January 2026 change nothing. The preview's kind `batch` posts D 31322 Animaux / C 7131 144 400,00 (source `close:batch:<entity>:2025`, label "Encours de production : animaux", OD on 31 December) and `provision` D 6196 / C 3913 8 740,00; the year close reverses them on 1 Jan 2026, D 7131 / C 31322 144 400,00 and D 3913 / C 7196 8 740,00 (`REVERSED_AT_OPENING.batch` true, `openingReversalOf`), with the à-nouveaux carrying 31322 and 3913. A second run posts 0 and the preview says `unchanged`; a second year close posts nothing. With the PCA off 31322 lands on 3132 Encours de Production, a CGNC leaf (`accounts.test.ts`: 31322, 7131 and 3913 are posting accounts in both charts; integration: D 3132 / C 7131). Browser: `e2e/batches-at-close.spec.ts` (the preview's 31322 line at 47 500,00, the refusal, the owner's value, the provision 2 500,00, both posted and found in the journal on 31 December 2025, Arabic RTL)._
- [x] A batch with no weighing or no sale requires a typed value before the run posts. _The run refuses (`runClose` → `BATCH_VALUE_MISSING`, "Saisissez la valeur actuelle des bandes en cours sans pesée ou sans vente avant de comptabiliser."), nothing posted, so the year close says `CLOSE_RUN_PENDING`; the preview shows the line "Valeur à saisir : ni pesée ni vente pour la proposer." and keeps the button, so the owner sees why. Integration "refuses the run while a batch with no weighing or no sale has no value; the owner's value lets it post, on 3132 with the PCA off" (a turkey batch never weighed, no turkey sold on the farm). The owner's value is a `YearEndValue` of kind `batch` (no migration: T108's table), owner only, audited, refused for another organisation's batch or a pullet one, frozen once the run posts (`COUNT_FROZEN`). Domain: "requires a value for a batch with no weighing or no sale"._
- [x] Pullet and layer batches are listed "non valorisés (FQ7)", not valued (until T114 / T115). _`MEAT_TYPES` (broiler, turkey, beldi, duck, quail) in `finance/domain/stocks.ts`; the others are in the preview's `batches` with `valued: false`, at no cost, and the page shows "Non valorisé (FQ7)" in the "Au coût" column without a field. Domain "… lists pullets and layers, not valued (FQ7)"; integration "§7.1 C: …; pullets and layers listed, not valued (FQ7)" (a pullet and a layer batch open on 31 December, left out of the 31322 line)._
- [x] `/results` figures for closed batches are unchanged by the as-of day (existing tests green). _`batchResults(ctx, asOf?)`: without the day, the same queries as before (`/results`, the report, the dashboard and the budget pass none); `batch-results.int.test.ts`'s four tests unchanged and green. Added: "as of a day, counts only the facts dated on or before it; a closed batch's figures are unchanged (FC4, T109)": as of 31 December, both batches' rows equal `/results`' (the closed one keeps its frozen 3 100,00); as of 31 October the bills and vet fees of 5 November and the sale of 2 November don't count, the closed batch is still open then; as of 16 October the feed eaten on the 17th doesn't; as of 1 October the batch placed on the 16th isn't listed. The day reaches each module through its index: `flock.batchesForFinance(…, asOf)` (placements, daily entries, sales of birds, other costs), `inventory.batchConsumption(…, asOf)`, `sales.salesByBatch(…, asOf)`; new minimal reads `flock.lastWeighings` and `sales.lastSales`._

  _Defaults: the kind is `batch`, between `stock` and `provision`. As of the day, a direct or shared expense counts by its day, a pay month once ended; a shared one is split as FN14 does, the batches closed by then keeping their frozen shares and the open ones sharing the rest by the bird-days known on that day. The farm's last sale of the type is its latest live sale by the kg or by the head up to the day (by day, then id), including the batch's own; its price is the one recorded, VAT included when there is any (as FN13's costs, FQ30). Birds on hand come from the count when entered, else from flock as on the day; birds sold are flock's up to the day. A batch with nothing left on hand carries no cost and needs no value. A typed value above cost leaves the batch at cost, as for stocks._
**Depends on:** T107, T104.
**Size:** M

### T112: Home consumption (FC7)
**Blocked by:** T100 (7140 Production Autoconsommée, confirmed in the PCA text; with the PCA off it lands on 714, which has sub-accounts: FQ21, FQ25). An individual's entry also waits for FQ11.
**Description:** The three sale forms (V2, V6, V7) get the kind "Consommation", with who took the birds or eggs (exploitant, associate, employee).
- It has no buyer and no payment. The withdrawal blocks, birds on hand and the FIFO egg draws apply as for a sale.
- The price is prefilled from the last sale of the same product (default FQ21).
- `sales` changes its record and change log; finance posts it in `OD`: D 4463 / 6171 / C 7140.
**AC:**
- [x] Recorded offline, synced once, birds on hand lowered; refused during a withdrawal (Playwright offline + integration). _`e2e/consumption.spec.ts` "an offline home consumption is refused during a withdrawal, then recorded and synced once": offline, "Consommation" on the sale form, price prefilled 14,50 from the last sale, refused on a withdrawal day, recorded for the day before, birds on hand 900 → 895, then one `Sale` row on the server (no buyer, method `none`, 145,00). Integration `sales/consumption.int.test.ts` "is recorded once, lowers birds on hand, …" (same mutation replayed, same record id refused `ALREADY_EXISTS`), "is refused during a withdrawal, and beyond the birds on hand, writing nothing", "draws eggs oldest first, …" (V6's FIFO and stock check). One mutation, `sales.recordConsumption`, for the three forms (`kind` live, perHead, eggs); the record is a `Sale` with `takenBy` and no buyer (migration `home_consumption`)._
- [x] An associate's posts D 4463 / C 7140; an employee's D 6171 / C 7140; an individual exploitant's posts nothing and is listed "non comptabilisé (FQ11)". _`finance/consumption.int.test.ts` "posts an associate's D 4463 / C 7140 and an employee's D 6171 / C 7140 in OD; a sale as before" and "posts nothing for the exploitant (FQ11), without a value, or with the PCA off (FQ25), and lists them on /books" (`readBooks(...).unposted`, reason from `unpostedConsumption` in `finance/domain/posting.ts`, the rule the pipeline skips by). With the PCA off 7140 lands on 714, which has sub-accounts: nothing is posted, no account invented, listed "non comptabilisé (FQ25)", and the pipeline is not blocked. The `/books` list in the browser: the end of `e2e/consumption.spec.ts`. A product never sold has no price (new FQ31): valued 0, listed too._
- [x] Counted in the batch's sales and kg sold (`batchResults` test). _`finance/consumption.int.test.ts` "counts with the batch's sales and kg sold (FN13)": 15 000,00 sold + 880,00 taken home, 1 000 kg + 60 kg (`salesByBatch` sums the `Sale` rows; the kg come from flock's sold birds)._
- [x] Workers record quantities but never see the price (stripped on pull, integration). _`sales/consumption.int.test.ts` "lets a worker record the quantities; the server prices them and the worker's pull carries no price (I5)": the mutation needs `flock.record`; a price sent by a worker is ignored and the last sale's used (4 kg × 15,00); the worker's pull has no `…Centimes`, payment or lines; a worker's sale is still `FORBIDDEN`. The forms show workers no price field (`seller` false in `components/sales.tsx`, `egg-sale.tsx`)._
**Depends on:** T100.
**Size:** M

### T119: Bank fees category (FC9)
**Blocked by:** T100 (6147 Services bancaires).
**Description:** New quick-expense category "Frais bancaires" in `EXPENSE_ACCOUNTS`, paid from the bank: D bank services account / C 5141, `BQ`. It lets a statement with fees reach "rapproché" on T111's screen.
**AC:**
- [x] "Frais bancaires" posts on the confirmed account and shows on `/settings/chart` (operations test). _`bank_fees: "6147"` in `EXPENSE_ACCOUNTS`; `domain/treasury.test.ts`: D 6147 / C 5141 with the bank account, `BQ`; `domain/operations.test.ts` "shows bank fees on 6147 Services bancaires in both charts"; `accounts.test.ts`: 6147 is a leaf with and without the PCA (a CGNC account, so the same in both columns). Paid from a bank account only: `bankOnly` refuses cash, credit and a bank with no account (`INVALID_INPUT`), and the form lists only bank accounts for it._
- [x] A statement with a fee line reaches difference 0 once the fee is booked (integration, T111's fixture plus a fee). _`finance/bank.int.test.ts` "T119: a statement with a fee line reaches 0…": the two-week fixture on a second account, printed 43 455,00 (45,00 of fees); the four lines ticked leave −45,00; the three wrong payment sources are refused; once booked (D 6147 / C 5141 on that account, `BQ`) and ticked, the difference is 0 and the account "rapproché"._
**Depends on:** T100, T111.
**Size:** S

### T113: Eggs at close (FC5, eggs)
**Blocked by:** none. The product owner approved `eggs` in finance's dependencies on 22 Nov 2026 (CAPABILITY-MAP, `eslint.config.mjs`); T100 seeded 3152 Produits finis (d’animaux) and 7132. With the PCA off, still FQ25 (below). Default FQ18 decided (value per egg typed by the owner).
**Description:** Egg stock (SPEC-m3 E2) on the count sheet with its book quantity. The close run values counted eggs × the typed value: D 3152 / C 7132, reversed by T104.
**AC:**
- [x] Eggs on the count sheet match `eggs` stock on the last day; the value is required before the run posts. _2026-11-22. `eggs.eggStockOnDay(tx, ctx, day)`: E2's `eggLots` per farm over the collections laid by the day and the gradings, discards and draws received by its end (they carry no day of their own). The sheet has one eggs line per farm (`YearEndCount` kind `eggs`, subject the farm), counted in whole eggs, fixed on `/eggs`. The owner types a value per egg on `/closing` (`YearEndValue` kind `eggs`: the value of one egg in centimes, typed in dirhams to the centime); the run refuses (`EGG_VALUE_MISSING`) and the year close says `CLOSE_RUN_PENDING` while eggs to post have none; counted 0, nothing. The "stock" entry carries D 3152 / C 7132 = counted (else book) eggs × the value, reversed on 1 January with it (T104). `finance/eggs-at-close.int.test.ts` (the day rule, the count, the refusal, 188 100 then 197 600 after a late collection by reversal and version 2, a rerun posting nothing, the reversal on 1 January 2026 and the à-nouveaux on 3152, the PCA off, a `cash_book` entity), `finance/domain/stocks.test.ts` "eggs at the close", browser `e2e/eggs-at-close.spec.ts` (also in Arabic)._
- [x] 2026-11-23, fix: after the run has posted, a line of the last day synced late with no value (eggs collected on 31 Dec, a meat batch open that day) still takes its value, so the rerun and the year close are no longer refused forever (FCX4). _`finance/close-late-facts.int.test.ts`: the run posts, a turkey batch placed and 500 eggs collected on 31 Dec are synced, the run is `BATCH_VALUE_MISSING` then `EGG_VALUE_MISSING` and the year close `CLOSE_RUN_PENDING`; each value is taken once (audited), the rerun posts the batch's reversal and version 2, the provision and the eggs, and the year closes. Changing or clearing a value already saved, a value for a line that isn't missing (alone or mixed with a missing one, nothing saved) and the count stay `COUNT_FROZEN`. The rule is in `saveYearEndValues`: once frozen, a change is accepted only for a line currently `missing` and only to a value. `/closing` shows the field for those lines only. Counts need no exception: a new line without a count uses its book quantity._
- [x] 2026-11-23, fix: the egg stock on the last day counts discards and draws on the farm day they happened, not the day the server received them, so a discard made offline on 31 Dec or a sale dated 31 Dec synced on 2 Jan leaves the 31 Dec book quantity. _`EggDiscard.day` (the phone's farm day, sent with `eggs.discardEggs`; a phone from before it falls back to the server's farm day, never before the laying day) and `EggDraw.day` (the sale's day, passed by `sales` to `drawEggs`), migration `egg_flow_day` backfilling existing rows with the farm day (Africa/Casablanca) of `createdAt`. `eggFlowsOnDay` takes collections, discards and draws by `day`, gradings by `laidOn` (a grading only moves eggs between items, so the farm's total doesn't depend on when it was done). A discard dated in the future or before its laying day is refused. `finance/eggs-at-close.int.test.ts` "counts a discard and a sale on the farm day they happened"._

  _Defaults: the value per egg is to the centime, so the line is exact (no rounding): FQ18 asks for the owner's estimate, not a computed cost, and half a centime per egg is below what that estimate can tell. With the PCA off nothing posts for the eggs and no value is asked: 3152 lands on 315, which has sub-accounts in the CGNC chart (FN4), so the preview says "Non comptabilisé (FQ25)" as FC7 does, until the accountant names the CGNC account. The close kind "Stocks achetés" is now "Stocks"._
**Depends on:** T108. **Size:** S

### T114: Laying hens, simplified method (FC6)
**Blocked by:** FQ7 (no safe default: choosing the method is the accountant's), and T100 (715 and the valuation basis, read from the PCA text: SPEC-finance §5 "Laying hens, what the text says"; 23711 / 23712 against the text's 2371 / 2372 is part of FQ7).
**Description:** The method choice per category in the accounting settings (locked once the year has an entry, like FN1). The close run values the laying flock per the PCA text, through 7151 / 7152.
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
- [x] The PCA PDF is in the repository (or its download is allowed) and T100 is done: every candidate account is confirmed or replaced. _`docs/sources/plan-comptable-agricole-2015.pdf`; all eight candidates confirmed._
- [ ] An expert-comptable has reviewed the T100 accounts and the FC posting rules, and answered or accepted the defaults above (FQ9, FQ16–FQ21).
- [ ] A pilot company closes a fiscal year in Dawra (count, close run, draft statements) and the accountant explains every difference with their own closing.
- [ ] SPEC-finance §8 "Accounting close, end of M6" criteria met.
