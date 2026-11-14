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
- [ ] Replaying the same sync twice creates no new entry (integration test).
- [ ] Editing a purchase posts a reversal and a new entry.
- [ ] With PCA off, a feed purchase posts to 6121.
**Size:** L

### T31: Sales, cheques and bills (FN6, FN11)
**Description:** `sales.listChangedSince`, rules for sales and receipts, portfolio of cheques and bills with states and reminders.
**AC:**
- [ ] A cheque received posts D 5111 / C 3421; cashed posts D 5141 / C 5111; unpaid moves the claim to 3424 and blocks the buyer for credit.
- [ ] Reminder notification on the agreed date.
**Size:** M

### T32: Treasury and quick expense (FN3, FN10, FX4)
**Description:** Bank accounts and cash boxes (opening balances through the à-nouveaux entry of T29; `cash_book` entities enter bank and cash balances only), transfers via 5115, treasury screen, offline quick-expense form on the phone (manager and owner), optional receipt photo.
**AC:**
- [ ] A quick expense recorded offline is posted once after sync.
- [ ] A worker cannot open the quick-expense screen or any finance endpoint (integration test).
**Size:** M

### T33: Ageing and credit limits (FN12)
**AC:**
- [ ] Ageing buckets match the fixture (77 days → 61–90).
- [ ] A credit sale above the buyer's limit waits for the owner's approval.
**Size:** S

### T34: Batch result and shared-cost allocation (FN13, FN14)
**Description:** Batch P&L from tagged lines and valued consumptions, `allocate` with bird-days default, freeze at close. Migrate the M1 T24 "other cost" entries.
**AC:**
- [ ] B-2026-13 fixture: margin 44 210,00, 1,87 DH/kg, cost 11,43 DH/kg.
- [ ] Allocated parts always sum to the shared total (property test).
- [ ] A closed batch keeps its allocation when the key changes.
- [ ] A feed purchase tagged with the batch does not change its cost; only the valued consumption does.
- [ ] An electricity bill paid in November with service period October is split across the batches present in October.
**Size:** L

### T35: Budget and break-even (FN15)
**AC:**
- [ ] Break-even and planned margin recompute on feed-price and sale-price input.
**Size:** M

### T36: Books and trial balance (FN16)
**AC:**
- [ ] Cash-book view for `cash_book` entities; journals, ledger and trial balance for `ledger` entities.
- [ ] Trial balance is balanced for any sequence of M1 events (property test).
**Size:** M

### T37: 5 M DH tracker (FN17)
**AC:**
- [ ] Fixture 4 260 450 + 690 000 → 99 %; alert from 90 %.
**Size:** S

### T38: Export to the accountant (FN18)
**AC:**
- [ ] CSV and Excel per period open in Excel with French formatting; zip with receipts.
**Size:** M

### T39: VAT on purchases and sales (FN9), after FQ4
**AC:**
- [ ] VAT-registered entity: recoverable VAT on 34552, collected VAT on 4455; otherwise the total goes to the charge.
**Size:** S

### ✅ Checkpoint M2-finance
- [ ] An expert-comptable has reviewed the charts and posting rules (T28, T30, T31) and imported one exported month (T38).
- [ ] The pilot farm's batch margin matches the owner's own calculation.
- [ ] SPEC-finance §8 criteria met.
