# ADR-010: One double-entry ledger, charts of accounts as data, staged delivery

## Status
Proposed. To be accepted after review by a Moroccan expert-comptable (questions FQ1–FQ4 in [SPEC-finance.md](../../SPEC-finance.md)).

## Date
2026-11-03

## Supersedes
Part of the finance scope recorded in [NEEDS-ANALYSIS.md](../../NEEDS-ANALYSIS.md) §3 and [SCOPE.md](../../SCOPE.md) §5:
- "MVP: cash book + management accounting per batch, plus a CSV/Excel export mapped to PCGE and to the cooperative chart. Full double-entry accounting comes later" (NEEDS-ANALYSIS §3, item E "C");
- "full accounting" listed in V3 (SCOPE §5).

Also replaces the `AccountingProfile` shape derived in SPEC F1 (`chart: cash_book | pcge | cooperative | association`).

## Context
- The finance mockups (canvas "Dawra — maquettes", page 5, 1 Nov 2026; a private claude.ai page, ask the owner for access) show a full ledger: generated journal entries, period locking, trial balance, year-end inventory with biological assets, simplified CGNC financial statements, and an export to the accountant. The product owner chose to follow them (3 Nov 2026).
- Three charts of accounts apply to our users (the [Dawra Accounting Primer](https://claude.ai/artifact/1rhzsgz9pQjGPcb8nT5Dwb), a private page, explains them; the accounts Dawra uses are listed in [SPEC-finance.md](../../SPEC-finance.md)):
  - **CGNC / PCGE** (law 9-88): the base for every Moroccan company.
  - **Plan Comptable Agricole (PCA)**, CNC opinion n° 7 of 22 Dec 2015: the CGNC refined for agricultural activity "whatever the legal form" (biological assets, animal purchases and sales, feed, vet products). The text is titled "projet"; whether it is mandatory is open (FQ1).
  - **Cooperative chart**, arrêté n° 441-01 of 26 Feb 2001, mandatory under law 112-12: the CGNC with adapted equity and member accounts. We do not have its official account list yet (FQ2).
- An individual farmer under the 5 M DH exemption only needs a receipts-and-expenses book. A company or cooperative needs full accounts.
- A cash book and a ledger built as two engines would double the work and diverge. A cash book is a view of the movements on cash and bank accounts.
- Finance is a strict module (ADR-008) at layer L6: it depends on `farm-registry`, `inventory`, `flock`, `sales` and `workforce`. Those modules cannot call finance.
- Money is integer centimes stored as `bigint` (SPEC §5).

## Decision

### 1. One ledger for every entity
- Every money event becomes a **balanced journal entry**: header (date, journal, source, period) + lines (account, debit, credit, analytic tags). Σdebit = Σcredit is checked in `finance/domain` and again at commit by a deferred constraint trigger on `JournalLine` (a row-level `CHECK` cannot see the other lines of the entry).
- **Posted entries are immutable.** A correction is a reversal entry plus a new entry. Edits and reversals are audited (ADR-006).
- **Periods** are calendar months inside a fiscal year (default 1 Jan–31 Dec, configurable per legal entity). A locked period refuses new entries. A correction of a locked period is posted in the first open period.
- The **legal form only changes the books Dawra shows and exports**, not the engine:
  - `cash_book` entities see a receipts-and-expenses book: the lines on cash, bank and cheque accounts (51xx), with their categories and batches;
  - `ledger` entities see journals, ledger, trial balance, statements.

### 2. Charts of accounts are data
- An account is a row: number, French label, Arabic label (later), class, **explicit parent**, source (`cgnc`, `pca`, `coop`), active flag. Roll-ups use the parent column, never string truncation (the PCA's 3131 and the CGNC's 3131 mean different things).
- An entity's chart = **one base + overlays**:

| Legal form | Books | Base | Overlays (default) |
|---|---|---|---|
| individual, indivision | `cash_book` | `cgnc` | `pca` |
| company, gie | `ledger` | `cgnc` | `pca` |
| cooperative | `ledger` once FQ2 is answered; `cash_book` + export until then | `coop` (`cgnc` until FQ2) | `pca` |
| association | `cash_book` | `cgnc` | none |

- Cooperative before FQ2: law 112-12 requires the cooperative chart, so Dawra's cash book does **not** make a cooperative compliant. Its accountant keeps the official books; Dawra feeds them through the export, and the UI says so.
- Association: cash book only until an associations chart is decided. No association-specific accounts are seeded.

- The owner (and the accountant once M5 gives them access) can switch the PCA overlay off **before the first entry of a fiscal year** only (CGNC "permanence des méthodes"). Same rule for the stock valuation method and the laying-hen method.
- Accounts are seeded from the official texts with their source cited. **No account number is invented**: missing cooperative numbers stay blocked until FQ2 is answered.

### 3. Posting rules turn farm events into entries
- The farmer never picks an account. A **posting rule** maps `(eventType, base, overlays)` to line templates. Example: `sale.live_birds` + PCA → D 3421 / C 712121.
- Posting is a **pure function** in `finance/domain`: `post(event, rules) → entry`. Same input, same entry.
- Finance **pulls** source records it has not posted yet from each dependency's `index.ts`, by cursor. It runs after each sync push and on demand. The unique key `(sourceModule, sourceId, sourceVersion)` makes posting idempotent (ADR-003). If a source record is edited (allowed until batch close, SPEC B2), finance posts a reversal and a new entry.
- Rules are versioned. A per-entity override (set by the owner, later the accountant) wins over the default rule. Changing a rule never rewrites posted entries.
- Entries are generated **on the server only**. The phone stores the farm event, which already works offline.

### 4. Two views of the same money
- **General ledger, by nature.** Purchases are expensed when the invoice is recorded (612x). Stock left at year end is corrected once (31x / 6124, 713x).
- **Management accounting, by batch.** Every line can carry `farmId`, `houseId`, `batchId`, or the tag "shared, to allocate". Batch cost = valued consumptions from `inventory` (SPEC S4–S5) + chick cost + direct non-stock charges + allocated shared charges. A purchase of a stocked item (feed, vet products, litter, gas) never counts in batch cost, even when tagged with a batch: only its consumption does, otherwise it would count twice. Daily feed consumption creates **no ledger entry**; it only feeds batch cost.
- Shared costs are allocated by a key per entity (default: bird-days present; alternatives: house m², kg sold). A shared line carries its **service period** (an electricity bill paid in November covers October), and the key is measured over that period, not on the payment date. The largest-remainder method makes the parts sum to the total. A closed batch keeps the key and the amounts used at its closing.

### 5. Staged delivery
| Stage | Milestone | Scope |
|---|---|---|
| **Finance core** | M2 "Money & compliance" | Ledger engine, CGNC + PCA charts, posting rules for every M1 event, cash and bank, cheques and bills portfolio, receivables and payables with ageing, quick expenses, batch P&L with allocation, cash-book view, 5 M DH tracker, CSV/Excel export, period locking |
| **Accounting close** | New M6, after M5 | Fixed assets and depreciation, loans, subsidies, year-end inventory and biological assets (classic and simplified methods), provisions, simplified CGNC statements (bilan, CPC, ETIC), bank statement import, accountant import format |
| **Cooperative** | Post-MVP module `cooperative` (CAPABILITY-MAP) | Cooperative overlay once FQ2 is answered, member register, member vs non-member operations, surplus allocation, ristournes, general assembly pack |

Payroll entries come with `workforce` in M4; the posting rule is part of that task.

## Alternatives considered
| Option | Why not |
|---|---|
| Cash book + export only (the old MVP decision) | The mockups and the owner want a ledger. An export with account numbers already needs posting rules, so most of the cost is paid anyway. A ledger added later would need a migration of every past event |
| Two engines: cash book for individuals, ledger for companies | Two code paths for the same events; a farm that grows past 5 M DH would change engines mid-life |
| Hard-coded chart per legal form (today's `accountingProfileOf`) | Cannot express "cooperative + PCA", cannot follow a correction by the accountant without a release |
| Source modules call finance on every write | Breaks the dependency direction (finance is L6). A cross-module transaction on every sale |
| Generate entries on the phone | Rules and charts would have to ship to every phone. Entries would need conflict handling. Nothing on the farm needs them offline |
| Plug in an external accounting package | No Moroccan PCA support we know of. Breaks offline-first and tenancy (ADR-003, ADR-006) |

## Consequences
- `AccountingProfile` in `farm-registry` becomes `{ books, base, overlays, coOwnerShares }`. Company and GIE move from `pcge` to `cgnc` + `pca`. This is the first finance task in M2; nothing reads the profile before then.
- New tables owned by `finance`: `Account`, `ChartOverlay`, `PostingRule`, `JournalEntry`, `JournalLine`, `FiscalPeriod`, `PostingCursor`. All carry `organizationId`; `JournalLine` carries the legal entity, analytic tags and, for shared lines, the service period.
- The fiscal year opens with an **à-nouveaux** entry that carries forward the closing balances of the balance-sheet accounts (classes 1–5). The first year in Dawra takes them from the accountant's last balance sheet (FQ11 covers `cash_book` entities, which have none).
- `inventory`, `flock`, `sales` (and `workforce` in M4) expose a `listChangedSince(cursor)` read in their `index.ts`.
- The CAPABILITY-MAP gets milestone M6 "Accounting close". `cooperative` stays post-MVP.
- Wrong account numbers are a legal risk. The seeded charts and the default posting rules need an accountant's review before the pilot uses finance (checkpoint in `tasks/plan-m2-finance.md`).
- Every money calculation is a pure, unit-tested function in `finance/domain`, with fixtures taken from the mockups' demo farm.
