# Spec: `finance` module

_v0.1, 3 Nov 2026. Status: **draft**, to be reviewed by a Moroccan expert-comptable (§9). Architecture: [ADR-010](docs/decisions/ADR-010-accounting-model.md). Screens: canvas "Dawra — maquettes", page 5 · Finance et comptabilité. Background for engineers: [Dawra Accounting Primer](https://claude.ai/artifact/1rhzsgz9pQjGPcb8nT5Dwb). Both are private claude.ai pages (ask the owner for access); everything needed to build is in this file. Conventions, stack and boundaries from [SPEC.md](SPEC.md) apply unchanged._

## 1. Objective

Turn what the farm already records (purchases, consumption, sales, payments) into **correct Moroccan accounting** without asking the farmer for an account number:
- **every entity** gets cash and bank, receivables and payables, and the **margin and cost per kg of each batch**;
- **companies and cooperatives** also get a double-entry ledger that follows the **CGNC**, refined by the **Plan Comptable Agricole** (CNC 2015) and, for cooperatives, the **cooperative chart** (arrêté 441-01, 2001);
- the **accountant** receives an export they can import and sign off.

**Users:** the owner (decides, locks periods, configures), the manager (records expenses and payments). Workers never see money (SPEC I5). The accountant gets access in M5 (`partner-access`).

**Out of scope here:** cooperative member features (module `cooperative`, post-MVP), payroll calculation (`workforce`, M4), the investment project / bank file screen (later), taxes filing.

## 2. Stages

| Stage | Milestone | Requirements |
|---|---|---|
| Finance core | **M2** "Money & compliance" | §4 (FN1–FN18) |
| Accounting close | **M6** (new, after M5) | §5 (FC1–FC10) |
| Cooperative accounting | post-MVP `cooperative` module | §6 (CO1–CO5) |

## 3. Concepts (as built)

| Concept | Rule |
|---|---|
| **Account** | Row with number, `labelFr`, `labelAr` (later), class 1–8, explicit `parentNumber`, `source` (`cgnc` · `pca` · `coop`), active. Roll-ups follow `parentNumber`, never string truncation |
| **Chart of an entity** | One base (`cgnc` or `coop`) + overlays (`pca`). Entity sub-accounts (one per bank account, cash box, buyer group) hang under a chart account |
| **Accounting profile** | `{ books: "cash_book" \| "ledger", base, overlays, coOwnerShares }`, derived from the legal form (ADR-010 table), adjustable by the owner before the first entry of a fiscal year |
| **Journal entry** | Header: legal entity, date (farm day), journal, piece reference, source (`module`, `id`, `version`), period, status `posted` \| `reversed`. Lines: account, `debitCents`, `creditCents` (bigint, one of them 0), label, `partyId?`, `farmId?`, `houseId?`, `batchId?`, `shared` flag with `serviceFrom` / `serviceTo` |
| **Journal** | Data, defaults: `AC` purchases, `VT` sales, `BQ` bank, `CA` cash, `EF` cheques and bills portfolio, `OD` miscellaneous |
| **Period** | Calendar month inside a fiscal year (default 1 Jan–31 Dec). States `open` → `locked` |
| **Posting rule** | `(eventType, base, overlays)` → line templates. Versioned. Per-entity override wins |
| **Party** | A buyer (`sales`) or supplier (`inventory`) referenced on 34xx / 44xx lines, which gives the sub-ledger per party |

## 4. M2 requirements: finance core

### Setup
- **FN1. Profile.** `farm-registry` derives the new profile shape (ADR-010). Company and GIE: `ledger`, `cgnc` + `pca`. Individual and indivision: `cash_book`, `cgnc` + `pca`. Cooperative: `cash_book` + export until FQ2 is answered, then `ledger`, `coop` + `pca`; until then the cooperative's accountant keeps the legal books and the cooperative screens say so. Association: `cash_book`, `cgnc`, no overlay. The owner can switch the PCA overlay, the books and the fiscal-year dates only while the fiscal year has no entry.
- **FN2. Charts.** Seed the CGNC accounts used by the posting rules (FN6) and the PCA overlay accounts below, each with its source document. Every account the rules reference exists in every chart that the rules target (checked by a unit test).

  | PCA account | Label | CGNC parent used when PCA is off |
  |---|---|---|
  | 612121 | Achats d'animaux | 6121 |
  | 612122 | Aliments de bétail | 6121 |
  | 612123 | Produits vétérinaires et autres produits de défense des animaux | 6122 |
  | 61221 | Achats de matières et fournitures | 6122 |
  | 61223 | Combustibles | 6122 |
  | 612511 · 612512 | Consommation d'eau · d'électricité | 6125 |
  | 612612 | Travaux et façons, productions animales | 6126 |
  | 712121 | Ventes d'animaux | 7121 |
  | 712128 | Ventes animaux à l'agrégateur | 7121 |
  | 71213 | Ventes de produits d'animaux | 7121 |
- **FN3. Cash and bank accounts.** The owner creates bank accounts (sub-accounts of 5141) and cash boxes per farm (sub-accounts of 5161), The fiscal year opens with an **à-nouveaux** entry (`OD`, first day of the year) that carries forward the balance-sheet accounts (classes 1–5): from the previous year in Dawra, or for the first year from the accountant's last balance sheet. A `cash_book` entity has no balance sheet: it enters only its bank and cash balances, and the counter-account is FQ11.

### Entries
- **FN4. Invariant.** An entry with Σdebit ≠ Σcredit, fewer than two lines, a line with both or neither side, or an account not in the entity's chart is rejected: domain check, plus a deferred constraint trigger on `JournalLine` that re-checks the balance at commit (a row-level `CHECK` cannot see the other lines).
- **FN5. Immutability and periods.** Posted entries are never updated or deleted. A correction posts a reversal (same lines, sides swapped, linked to the original) and a new entry. A locked period refuses entries; the correction of a locked period goes to the first open period. Locking and unlocking: owner only, audited.
- **FN6. Default posting rules.** PCA accounts shown; the CGNC parent of FN2 applies when PCA is off.

  | Event (source) | Debit | Credit | Journal |
  |---|---|---|---|
  | Chick purchase (`flock` placement, SPEC B1) | 612121 | 4411 hatchery | AC |
  | Feed purchase | 612122 | 4411 | AC |
  | Vaccine / medicine / disinfectant purchase | 612123 | 4411 | AC |
  | Litter purchase | 61221 | 4411 | AC |
  | Gas / fuel purchase | 61223 | 4411 | AC |
  | Purchase paid at once | same charge | 5161 or 5141 | CA / BQ |
  | Supplier payment, cash or transfer | 4411 | 5161 / 5141 | CA / BQ |
  | Supplier payment, cheque issued | 4411 | 5141, **on the issue date** | BQ |
  | Supplier payment, bill accepted | 4411 | 4415 | OD |
  | Issued bill paid at due date | 4415 | 5141 | BQ |
  | Live-bird sale (`sales`) | 3421 buyer | 712121 | VT |
  | Receipt, cash or transfer | 5161 / 5141 | 3421 | CA / BQ |
  | Cheque received | **5111** | 3421 | EF |
  | Bill received (traite) | 3425 | 3421 | EF |
  | Bill at due date, remitted to bank | 5113 | 3425 | EF |
  | Cheque or bill cashed | 5141 | 5111 / 5113 | BQ |
  | Cheque or bill unpaid | **3424** | 5141 or 5111 / 5113 | BQ / EF |
  | Quick expense: electricity · water | 612512 · 612511 | 5161 / 5141 / 4411 | CA / BQ / AC |
  | Quick expense: vet fees · insurance · catching crew or transport | 6136 · 6134 · 612612 | idem | idem |
  | Cash deposited to bank (two entries) | 5115, then 5141 | 5161, then 5115 | CA, then BQ |
  | Cash withdrawn from bank (two entries) | 5115, then 5161 | 5141, then 5115 | BQ, then CA |
  | Staff advance | 3431 | 5161 | CA |
  | Owner or partner contribution / withdrawal | 5141 · 4463 (company) or exploitant account (FQ11) | the other | BQ |

  Daily feed consumption, mortality and stock adjustments create **no entry** (FN13 uses them).
- **FN7. Posting pipeline.** After each sync push, and on demand, finance reads records changed since its cursor through `inventory`, `flock` and `sales` `index.ts` (`listChangedSince(cursor)`) and posts them. The unique key `(sourceModule, sourceId, sourceVersion)` makes a replay a no-op. A source record edited later gets a reversal and a new entry. Posting runs on the server only.
- **FN8. Overrides.** The owner can override the account of a default rule for one entity (e.g. a specific expense category). The override applies to new entries only and is audited.
- **FN9. VAT.** Purchases and sales store the invoice total and an optional VAT amount. If the entity is VAT-registered and the VAT is recoverable, the VAT goes to 34552 (purchases) and 4455 (sales); otherwise the full amount goes to the charge. Default: not registered, until FQ4 is answered.

### Cash, portfolio, third parties
- **FN10. Treasury screen.** Balance per bank account and cash box, movements of the month with journal, counter-account, batch and "receipt attached" flag. Total available = Σ 5141 + Σ 5161.
- **FN11. Cheques and bills.** Each cheque or bill (received or issued) has number, party, amount, agreed date, state (`in_portfolio` → `remitted` → `cashed` \| `unpaid`; issued: `issued` → `debited`) and the sale or purchase it settles. Reminders on the agreed date through `notifications`. A post-dated cheque stays payable on sight; the agreed date is only a reminder.
- **FN12. Ageing and credit limits.** Per buyer: amount due split into not due, 1–30, 31–60, 61–90, 90+ days by due date. Per supplier: amount due with due dates. A buyer can have a credit limit; a sale on credit that would exceed it needs the owner's approval. A buyer with an unpaid cheque is blocked for credit until the owner unblocks them.

### Batch accounting
- **FN13. Batch result.** For each batch: sales (712x lines tagged with the batch) − direct costs (valued consumptions from `inventory`, chick cost from the placement, non-stock charges tagged with the batch) − allocated shared costs = **margin**. A purchase of a stocked item (feed, vet products, litter, gas) is never a batch cost, even if tagged: only its consumption counts, so nothing is counted twice. Shows DH, DH/kg sold and % of sales, plus the comparison with the farm's last batches (mortality, FCR, feed price, cost/kg, price/kg, margin/kg). Replaces the "other cost" entry of M1 T24, whose amounts are migrated as direct charges.
- **FN14. Shared-cost allocation.** A `shared` line carries a **service period** (from, to; default: the month of the line's date). It is split across the farm's batches present during that period, by the entity's key measured over that period: **bird-days** (default), house m², or kg sold. Largest-remainder rounding (§7). At batch close the key and the allocated amounts are frozen.
- **FN15. Budget and break-even.** A budget per planned batch, copied from a closed batch, with what-if inputs for feed price and sale price. Break-even price/kg and planned margin update live. Weekly cash need of the batch from the purchase dates and supplier credit terms.

### Views, tax helper, export
- **FN16. Books per profile.** `cash_book`: receipts and expenses (lines on 51xx accounts) with category and batch, monthly totals. `ledger`: journals, general ledger by account, trial balance per period, and every `cash_book` view.
- **FN17. 5 M DH tracker.** Agricultural sales booked in the fiscal year (712x) + planned sales from open batches and budgets, against the threshold; alert at 90 %; history of the last 3 years. Threshold and rule text are configuration with a validity date (FQ5).
- **FN18. Export.** Per period: entries as CSV and Excel (date, journal, piece, account, account label, line label, debit, credit, party, farm, house, batch), trial balance, cash book, and attached receipts as a zip. The cabinet-specific import format is added in M6 (FQ10).

### Cross-cutting (finance)
- **FX1.** Every amount is integer centimes (`bigint`); displayed `1 234,50 DH`; no float in any finance code path.
- **FX2.** Workers never receive finance data from any endpoint (SPEC I5). Manager: records expenses, payments, cheques; sees all finance screens. Owner: also periods, profile, overrides, credit limits and approvals.
- **FX3.** Finance tables are tenant-scoped and isolation-tested like every M1 table (SPEC X3).
- **FX4.** Quick expenses can be recorded offline on the phone (they are farm events); their entry is posted after sync.
- **FX5.** All finance strings exist in `fr.json` and `ar.json`. Account labels are French in M2; Arabic labels are added with the official translation (FQ12).

## 5. M6 requirements: accounting close (summary)

To be detailed when M6 starts.
- **FC1. Fixed assets.** Register with account (231x–234x), date in service, cost, residual value, life; straight-line depreciation with prorata (FQ9); D 6193 / C 28xx each year.
- **FC2. Loans and subsidies.** Schedule (equal capital repayments, quarterly or monthly), capital on 1481, interest on 6311. Investment subsidy on 1311, released to 7577 at the depreciation rate.
- **FC3. Year-end count.** Printable count sheet; birds and stock counted on 31 Dec with the gap to the books.
- **FC4. Batches in progress.** Consumable animals alive at year end valued at cost engaged (from FN13): D 31322 / C 7131. If current value < cost: provision D 6196 / C 3913. Opening values reversed on 1 Jan.
- **FC5. Stocks.** Feed, vet products, consumables, packaging and eggs at weighted average cost: D 31x / C 6124 or 7132.
- **FC6. Laying hens.** Per category, classic method (23711 / 28371, depreciation over the laying period, culled hens sold to 7187) or simplified method (715 inventory variation, no depreciation), chosen before the first entry of the year (FQ7, FQ8). Own pullets: D 23962 / C 71431.
- **FC7. Home consumption.** Birds or eggs taken by the exploitant, partners or staff: D exploitant account / 4463 / 617x, C 7140.
- **FC8. Statements.** Simplified CGNC model (revenue ≤ 10 M DH): bilan, CPC, ETIC including the PCA biological-asset tables; draft until the accountant signs off.
- **FC9. Bank reconciliation.** Statement import (format per bank) and matching against 5141 lines.
- **FC10. Accountant import format** for the firms' software (FQ10).

## 6. Cooperative accounting (post-MVP, summary)

- **CO1.** Cooperative overlay seeded from the official text of arrêté 441-01 (FQ2). No number before that.
- **CO2.** Member register: shares subscribed and paid, join and leave dates.
- **CO3.** Every sale and purchase tagged member / non-member.
- **CO4.** Surplus allocation voted in general assembly: reserves, interest on paid shares, ristournes, recorded separately.
- **CO5.** Ristourne per member = member's operations × amount voted ÷ total member operations; non-member operations excluded.

## 7. Calculations and test fixtures

Every formula is a pure function in `src/modules/finance/domain/`, in integer centimes, rounded once at the end. Fixtures come from the demo farm on the canvas.

| Function | Formula | Fixture → expected |
|---|---|---|
| `entryIsBalanced` | Σdebit = Σcredit, ≥ 2 lines, one side per line | sale 131 856,00 D 3421 / C 712121 → true |
| `batchResult` | sales − direct − allocated | B-2026-13: 315 010,00 − 270 800,00 → margin 44 210,00; 1,87 DH/kg; 14,0 % |
| `costPerKg` | total cost ÷ kg sold | 270 800,00 ÷ 23 700 kg → 11,43 |
| `allocate` | largest remainder over keys | 16 500,00 by 405 000 / 337 500 bird-days → 9 000,00 / 7 500,00; parts always sum to the total |
| `breakEvenPrice` | planned cost ÷ planned kg | 270 800,00 ÷ 23 700 → 11,43 |
| `weightedAverageCost` | (value + cost in) ÷ (qty + qty in) | 9 200,00 for 2 000 kg + 36 950,00 for 8 000 kg → 4,615 DH/kg |
| `ageingBucket` | today − due date | due 20 Aug, today 5 Nov → 77 days → 61–90 |
| `thresholdUsage` | (booked + planned) ÷ threshold | 4 260 450 + 690 000 → 4 950 450; 99 % |
| `straightLine` (M6) | (cost − residual) ÷ life × months ÷ 12 | hens 252 000 − 90 000, 14 months, 7 months → 81 000,00 |
| `loanInstallment` (M6) | capital = principal ÷ n; interest = outstanding × rate ÷ periods | 900 000 / 28; 642 860 × 5,55 % ÷ 4 → 32 142,86 + 8 919,68 |
| `stockAtCloseValue` (M6) | min(cost, current value), provision = difference | 98 400 vs 97 300 → 97 300, provision 1 100,00 |
| `ristourne` (coop) | ops × voted ÷ total member ops | 412 000 × 220 000 ÷ 6 950 000 → 13 041,73 |

## 8. Success criteria (finance core, end of M2)

1. All §7 M2 fixtures pass. A property test posts random sequences of M1 events and checks that the trial balance is always balanced and that replaying the same sync twice changes nothing.
2. The pilot farm closes a batch and its margin and cost per kg match the owner's own calculation.
3. An expert-comptable has reviewed the seeded charts and the FN6 posting rules, and imported one month of export into their software.
4. Tenant isolation and the "worker never sees money" rule are covered by integration tests on every finance endpoint.

## 9. Open questions for the expert-comptable

| # | Question | Blocks |
|---|---|---|
| FQ1 | Is the PCA (CNC opinion n° 7, 2015) mandatory, or a recommended project? | Default overlay (FN1) |
| FQ2 | Official account list of the cooperative chart (arrêté 441-01) | Cooperative ledger (FN1, CO1) |
| FQ3 | Can a cooperative combine the cooperative chart with PCA accounts? | Cooperative profile |
| FQ4 | VAT on feed, chicks, live birds, eggs; when is a farm VAT-registered? | FN9 |
| FQ5 | Exact conditions of the 5 M DH agricultural exemption (3-year rule) and the cooperative IS threshold | FN17 |
| FQ6 | An individual taxed on real net income (RNR): ledger required? | FN1 |
| FQ7 | Laying hens: classic or simplified method by default? | FC6 |
| FQ8 | Culled hens under the classic method: how is the remaining book value removed next to 7187? | FC6 |
| FQ9 | Depreciation prorata: by month or by day? | FC1 |
| FQ10 | Import formats of the accounting software used by the firms | FN18, FC10 |
| FQ11 | Account for the individual exploitant's contributions and withdrawals, and counter-account of a `cash_book` entity's opening bank and cash balances | FN3, FN6 |
| FQ12 | Is there an official Arabic version of the CGNC and PCA account labels? | FX5 |
| FQ13 | Journal for cheques and bills received (`EF` here): common practice? | FN6 |
