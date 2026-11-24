# Spec: `finance` module

_v0.1, 3 Nov 2026; §5 (M6) detailed 20 Nov 2026. Status: **draft**, to be reviewed by a Moroccan expert-comptable (§9). Architecture: [ADR-010](docs/decisions/ADR-010-accounting-model.md). Screens: canvas "Dawra — maquettes", page 5 · Finance et comptabilité. Background for engineers: [Dawra Accounting Primer](https://claude.ai/artifact/ASycXSbhioZ73rQhs6Hiqx). Both are private claude.ai pages (ask the owner for access); everything needed to build is in this file. Conventions, stack and boundaries from [SPEC.md](SPEC.md) apply unchanged._

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
| Accounting close | **M6** (new, after M5) | §5 (FCX1–FCX6, FC1–FC10) |
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
  - **Built on `/books` (2026-11-23):** the month's lock shows to every reader, with the fiscal year's locked months; the owner locks it ("Clôturer le mois", after sending the export) or unlocks it ("Rouvrir le mois"). A month of a closed fiscal year is never unlocked this way: `FISCAL_YEAR_CLOSED`, the year's reopen (FCX6) on `/closing` is the way back. On a manual entry (FCX3) of the journal, the owner's "Annuler l’écriture", after a confirmation, posts its reversal ("Annulation : <label>") on the entry's day, or the 1st of the first open month after it when that month is locked; once per entry (`ALREADY_REVERSED`, also for two at once). Other entries are refused (`NOT_MANUAL_ENTRY`): their own module's flow reverses them (FN7). The owner then types the right entry.
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
  | Cheque received | **51111** Chèques en portefeuille | 3421 | EF |
  | Cheque remitted to bank | 51112 Chèques à l’encaissement | 51111 | EF |
  | Bill received (traite) | 3425 | 3421 | EF |
  | Bill at due date, remitted to bank | 51132 Effets à l’encaissement | 3425 | EF |
  | Cheque or bill cashed | 5141 | 51111 / 51112 / 51132 | BQ |
  | Cheque or bill unpaid | **3424** | 5141 or 51111 / 51112 / 51132 / 3425 | BQ / EF |
  | Quick expense: electricity · water | 612512 · 612511 | 5161 / 5141 / 4411 | CA / BQ / AC |
  | Quick expense: vet fees · insurance · catching crew or transport | 6136 · 6134 · 612612 | idem | idem |
  | Quick expense: bank fees (FC9) | 61473 | 5141 | BQ |
  | Cash deposited to bank (two entries) | 5115, then 5141 | 5161, then 5115 | CA, then BQ |
  | Cash withdrawn from bank (two entries) | 5115, then 5161 | 5141, then 5115 | BQ, then CA |
  | Staff advance | 3431 | 5161 | CA |
  | Owner or partner contribution / withdrawal | 5141 or 5161 · 4463 (associates) or 1117 Capital personnel (individual exploitant, FQ11, §9) | the other | BQ / CA |

  A placement records the hatchery as free text, with no supplier: its chicks (or point-of-lay hens, FC6) are paid from `/treasury`, at most what is still owed for that placement (§9 "Placement debts").
  A quick expense on credit is paid from `/treasury` too, at most what is still owed for it (§9 "Credit expenses").
  Where the CGNC subdivides an account, the rule posts to its leaf (FN4; §9 "FN4 sweep"). Daily feed consumption, mortality and stock adjustments create **no entry** (FN13 uses them).
- **FN7. Posting pipeline.** After each sync push, and on demand, finance reads records changed since its cursor through `inventory`, `flock` and `sales` `index.ts` (`listChangedSince(cursor)`) and posts them. The unique key `(sourceModule, sourceId, sourceVersion)` makes a replay a no-op. A source record edited later gets a reversal and a new entry. Posting runs on the server only.
- **FN8. Overrides.** The owner can override the account of a default rule for one entity (e.g. a specific expense category). The override applies to new entries only and is audited.
  - **Built on `/settings/posting` (2026-11-24):** each FN6 charge or revenue rule (class 6 or 7, from the chart screen's list, quick expenses included) with its default account in the entity's chart and its override. The owner picks a posting account of the entity's chart in the default's class (`UNKNOWN_ACCOUNT`, `WRONG_ACCOUNT_CLASS`; a balance-sheet rule: `NOT_OVERRIDABLE`) or goes back to the default; each change is a new row of the entity's override history, audited. The posting pipeline (FN7) and quick expenses apply it before mapping to the chart (§9 "Posting overrides"). The chart screen (`/settings/chart`, owner and manager) shows the replacement under the default, read-only.
- **FN9. VAT.** Purchases and sales store the invoice total and an optional VAT amount. If the entity is VAT-registered and the VAT is recoverable, the VAT goes to 34552 État – TVA récupérable sur les charges (purchases and quick expenses; 34551 … sur immobilisations for a fixed asset, FC1; §9 "FN4 sweep") and 4455 (sales); otherwise the full amount goes to the charge. Default: not registered, until FQ4 is answered.

### Cash, portfolio, third parties
- **FN10. Treasury screen.** Balance per bank account and cash box, movements of the month with journal, counter-account, batch and "receipt attached" flag. Total available = Σ 5141 + Σ 5161.
- **FN11. Cheques and bills.** Each cheque or bill (received or issued) has number, party, amount, agreed date, state (`in_portfolio` → `remitted` → `cashed` \| `unpaid`; issued: `issued` → `debited`) and the sale or purchase it settles. Reminders on the agreed date through `notifications`. A post-dated cheque stays payable on sight; the agreed date is only a reminder.
- **FN12. Ageing and credit limits.** Per buyer: amount due split into not due, 1–30, 31–60, 61–90, 90+ days by due date. Per supplier: amount due with due dates. A buyer can have a credit limit; a sale on credit that would exceed it needs the owner's approval. A buyer with an unpaid cheque is blocked for credit until the owner unblocks them.

### Batch accounting
- **FN13. Batch result.** For each batch: sales (712x lines tagged with the batch) − direct costs (valued consumptions from `inventory`, chick cost from the placement, non-stock charges tagged with the batch) − allocated shared costs = **margin**. A purchase of a stocked item (feed, vet products, litter, gas) is never a batch cost, even if tagged: only its consumption counts, so nothing is counted twice. Shows DH, DH/kg sold and % of sales, plus the comparison with the farm's last batches (mortality, FCR, feed price, cost/kg, price/kg, margin/kg). Replaces the "other cost" entry of M1 T24: no new one, the old ones still count (§9 "M1 other costs").
- **FN14. Shared-cost allocation.** A `shared` line carries a **service period** (from, to; default: the month of the line's date). It is split across the farm's batches present during that period, by the entity's key measured over that period: **bird-days** (default), house m², or kg sold. Largest-remainder rounding (§7). At batch close the key and the allocated amounts are frozen.
  - **Built (2026-11-23):** the key is `LegalEntity.allocationKey` (`birdDays` | `houseArea` | `kgSold`), on `/settings/accounting`, changed only while the fiscal year has no entry (FN1). It applies to every shared line, the validated pay months included, and to the share of a batch not yet frozen; a frozen batch keeps its amounts. House m² and the fallback: §9 "FN14 allocation keys".
- **FN15. Budget and break-even.** A budget per planned batch, copied from a closed batch, with what-if inputs for feed price and sale price. Break-even price/kg and planned margin update live. Weekly cash need of the batch from the purchase dates and supplier credit terms.

### Views, tax helper, export
- **FN16. Books per profile.** `cash_book`: receipts and expenses (lines on 51xx accounts) with category and batch, monthly totals. `ledger`: journals, general ledger by account, trial balance per period, and every `cash_book` view.
- **FN17. 5 M DH tracker.** Agricultural sales booked in the fiscal year (712x) + planned sales from open batches and budgets, against the threshold; alert at 90 %; history of the last 3 years. Threshold and rule text are configuration with a validity date (FQ5).
- **FN18. Export.** Per period: entries as CSV and Excel (date, journal, piece, account, account label, line label, debit, credit, party, farm, house, batch), trial balance, cash book, and attached receipts as a zip. The FEC for the firm's software is added in M6 (FC10).

### Cross-cutting (finance)
- **FX1.** Every amount is integer centimes (`bigint`); displayed `1 234,50 DH`; no float in any finance code path.
- **FX2.** Workers never receive finance data from any endpoint (SPEC I5). Manager: records expenses, payments, cheques; sees all finance screens. Owner: also periods, profile, overrides, credit limits and approvals.
- **FX3.** Finance tables are tenant-scoped and isolation-tested like every M1 table (SPEC X3).
- **FX4.** Quick expenses can be recorded offline on the phone (they are farm events); their entry is posted after sync.
- **FX5.** All finance strings exist in `fr.json` and `ar.json`. Account labels are French in M2; Arabic labels are added with the official translation (FQ12).

## 5. M6 requirements: accounting close

M6 closes a fiscal year in Dawra: what the farm owns and owes at year end (fixed assets, loans, subsidies, stocks, animals), the year-end entries, and the statements the accountant signs. It builds on the M2 ledger as built: `postEntry`, reversals, locked months and `openFiscalYear` (T29), the posting pipeline and its source keys (T30), the batch cost (FN13, T34), the treasury accounts (T32) and the draft CPC (`/books`, U16). Plan: [tasks/plan-m6.md](tasks/plan-m6.md).

**Accounts.** T100 seeded the PCA nomenclature (chapter 5 of the text, classes 1–8; copy in `docs/sources/plan-comptable-agricole-2015.pdf`) into `prisma/seed/finance/accounts.json`, labels as printed. Every account this section names is in the seed with its printed label (`accounts.test.ts`). An account the PCA text doesn't have blocks its rule until the accountant answers; no number is invented (ADR-010 §2). Fourteen printed rows are left out (§9 "Found for the accountant").
- **Posting accounts only (FN4).** A line can't go on an account with sub-accounts. Where the nomenclature subdivides an account, a rule posts to a leaf: for example 6124 has 61241 (→ 612411–612413), 61242 and 61243, so FC5 posts to those, never to 6124.
- **PCA off.** A PCA account posts to its `fallback`, the nearest CGNC ancestor (FN2). Where that ancestor has sub-accounts in the CGNC chart, it can't take the line either: 3152 → 315, 7140 → 714, and the hens accounts 23711 → 23, 28371 → 283, 23962 → 239, 7151 / 7152 → 71, 7187 → 718. A rule using them with the PCA off needs a CGNC account from the accountant (§9). Exception: 61936 / 61937 (D.E.A of plantations and animals) fall back to 61938, the CGNC's "autres immobilisations corporelles" leaf, not to 6193 (§9 "Decided defaults").

**Candidates (confirmed by T100).** The numbers this section first gave as candidates are all in the nomenclature with the role assumed: 4481, 6513, 7513, 1319, 3912, 7196, 6147, and 2351–2358 for furniture and office equipment (labels in "Accounts from the PCA nomenclature" below).

**Defaults.** Where an open question blocks a choice, the requirement states a **default, to confirm with the accountant**, and names the question. A requirement with no safe default is marked **blocked**.

### Accounts from the PCA nomenclature (T100)
Numbers and labels as printed in the PCA nomenclature (chapter 5, pages 53–71). "Default" means T100's reading of the text, to confirm with the accountant.

| Role (§5) | Account, printed label |
|---|---|
| Debts on fixed-asset acquisitions (FC1) | 4481 Dettes sur acquisition d’immobilisations (1486 Fournisseurs d’immobilisations also exists in class 1: §9) |
| Net book value of tangible assets disposed of (FC1) | 6513 VNA des immobilisations corporelles cédées |
| Proceeds of tangible-asset disposals (FC1) | 7513 Produits des cessions des immobilisations corporelles |
| Depreciation charge (FC1, FC6) | a sub-account of 6193 Dotations d’exploitation aux amortissements des immobilisations corporelles, by asset kind (CGNC scan p. 296; PCA pp. 123–124): 61932 D.E.A. des constructions, 61933 D.E.A. des installations techniques, matériel et outillage, 61934 D.E.A. du matériel de transport, 61935 D.E.A. des mobilier, matériel de bureau et aménagements divers, 61937 D.E.A des Animaux (FC6, PCA; 61938 with the PCA off). 6193 itself takes no line (FN4) |
| Loans (FC2) | 1481 Emprunts auprès des établissements de crédit; 63111 Intérêts des emprunts (under 6311 Intérêts des emprunts et dettes, FN4) |
| Investment subsidies (FC2) | 1311 Subventions d’investissement reçues; 1319 Subventions d’investissement inscrites au compte de produits et charges; 7577 Reprises sur subventions d’investissement de l’exercice |
| Batches in progress (FC4) | 31322 Animaux (under 3132 Encours de Production); 71311 Variation des stocks de biens produits en cours (under 7131); 61961 D.E.P. pour dépréciation des stocks (under 6196 Dotations d’exploitation aux provisions pour dépréciations de l’actif circulant, FN4); 3913 Provisions pour dépréciation des produits en cours |
| Reversals of current-asset provisions (FC4, FC5) | 7196 Reprises sur provisions pour dépréciation de l’actif circulant |
| Provision on materials and supplies (FC5) | 3912 Provisions pour dépréciation des matières et fournitures |
| Own products in stock, eggs (FC5) | 3152 Produits finis (d’animaux); 71321 Variation des stocks de produits finis (under 7132 Variation des stocks de biens produits, FN4) |
| Hens, classic method (FC6) | 23711 Animaux Reproducteurs Adultes; 23712 Animaux Reproducteurs Jeunes de Renouvellement; 23962 Immobilisations en cours - animaux; 71431 Immobilisations corporelles agricoles produites; 28371 Amortissements des animaux reproducteurs; 7187 Produits de cessions courantes d'éléments d'actif |
| Hens, simplified method (FC6) | 715 Variation d’inventaire: 7151 … Animaux reproducteurs immobilisés Adulte, 7152 … Jeunes de renouvellement |
| Home consumption (FC7) | 7140 Production Autoconsommée, under 714 Production Autoconsommée et Immobilisations produites par l’entreprise pour elle-même |
| Bank services (FC9) | 61473 Frais et commissions sur services bancaires (under 6147 Services bancaires, FN4) |

**Fixed-asset categories (FC1), default:**

| Category | Asset account | Depreciation | Charge |
|---|---|---|---|
| Land | 23111 Terrains nus d’exploitation (23121 Terrains aménagés d’exploitation for prepared land); 2311 / 2312 with the PCA off | none | none |
| Buildings, poultry houses included | 23211 Bâtiments d’exploitation (2321 with the PCA off); 23231 on someone else's land | 28321 Amortissements des bâtiments (28323 … des constructions sur terrains d’autrui for 23231) | 61932 D.E.A. des constructions |
| Technical installations, equipment and tools | 233111 Installations techniques Agricoles sur sol propre (233112 on someone else's land; 2331 with the PCA off); 23321 Matériel (under 2332 Matériel et outillage) for movable equipment | 28331 Amortissements des installations techniques (28332 … du matériel et outillage for 23321) | 61933 D.E.A. des installations techniques, matériel et outillage |
| Transport equipment | 2340 Matériel de transport | 2834 Amortissements du matériel de transport | 61934 D.E.A. du matériel de transport |
| Furniture and office equipment | 2351 Mobilier de bureau, 2352 Matériel de bureau, 2355 Matériel informatique, 2358 Autres mobilier, matériel de bureau et aménagements divers | 28351 … du mobilier de bureau, 28352 … du matériel de bureau, 28355 … du matériel informatique, 28358 … des autres mobilier, matériel de bureau et aménagements divers (under 2835), one per asset account | 61935 D.E.A. des mobilier, matériel de bureau et aménagements divers |

The "d’exploitation / hors exploitation" split follows the text: "hors exploitation" land is land not used by the farm (chapter 6, account 231, p. 84). Each depreciation and charge account above is a leaf, in both charts. 6193 is not: the CGNC subdivides it by asset kind, each 6193x paired with its 283x (scan p. 296), so a category's charge goes on the sub-account that matches its depreciation account (§9 "Decided defaults"). 61938 D.E.A. des autres immobilisations corporelles (with 2838) has no category yet. The CGNC also subdivides 2332, 2832, 2833 and 2835 (scan pp. 266, 271–272), so the asset and depreciation accounts above are their leaves; 2834 has none (§9 "FN4 sweep").

**Bought stock by kind (FC5), default.** The stock account follows the purchase account's family (FN6), and the variation account is the matching 6124 leaf:

| Stock kind | Purchase (FN6) | Stock | Variation |
|---|---|---|---|
| Feed, vaccines, medicines | 612122, 612123 (6121 Achats de matières premières) | 3121 Matières premières | 612412 Variation des stocks de matières premières Agricoles – Animaux |
| Litter, other | 61221 | 31221 Matières consommables | 61242 Variation des stocks de Matières et Fournitures consommables |
| Gas | 61223 | 31223 Combustibles | 61242 |
| Packaging | 6123 Achats d’emballages | a leaf of 3123 Emballages: 31231 Emballages perdus, 31232 Emballages récupérables non identifiables, 31233 Emballages à usage mixte (which one: §9) | 61243 Variation des stocks d’emballage |

With the PCA off, 612412 lands on 61241 Variation des stocks de Matières Premières, a leaf in the CGNC chart.

**Laying hens, what the text says (FC6, FQ7).**
- Valuation (chapter 4, p. 52, "animaux reproducteurs traités selon la méthode simplifiée"):
  - entry value at acquisition cost, or at production cost for young stock reared on the farm;
  - unit by unit for identified animals, otherwise weighted average cost or FIFO;
  - on the balance sheet, the lower of entry value and current value, through a provision for impairment.
- Simplified method (chapter 6, "Poste 715", p. 131):
  - purchases on 612121 and sales on 712121 during the year;
  - at the count, the breeding stock's value is debited to the breeding-animal accounts and credited to 7151 / 7152;
  - the previous year's value is reversed, debited to 7151 / 7152 and credited to the breeding-animal accounts;
  - no depreciation.
- **The text is inconsistent** on the balance-sheet account. Chapter 6 names "2371 Animaux reproducteurs adultes" and "2372 Animaux reproducteurs jeunes de renouvellement" (p. 131), but in the nomenclature 2371 is Animaux Reproducteurs (23711 Adultes, 23712 Jeunes de Renouvellement) and 2372 is Animaux de service (p. 56). Decided default, to review (FQ7b, §9 "Decided defaults"): 23711 / 23712.

### Close rules (all FC)
- **FCX1. Roles.**
  - Owner (`finance.manage`): the asset, loan and subsidy registers, manual entries, the close run and the year close.
  - Manager (`finance.record`): loan installments paid, the year-end count and bank matching. Sees every M6 screen.
  - Accountant (`money.read`, SPEC-m5 PA5): reads every M6 screen and downloads; writes nothing (NQ7).
  - Workers: nothing (FX2). The printed count sheet carries no amount, so the owner can hand it to a worker.
- **FCX2. Online.** M6 screens are online office screens rendered on the server, like `/books`, linked from "Plus" › Argent. The one exception is FC7, which uses the sale forms and so works offline. The printed count sheet works on paper.
- **FCX3. Manual entry.** The owner posts an `OD` entry by hand: day, label, piece reference, optional receipt (ADR-011), and lines on any posting account of the entity's chart. It goes through `postEntry`: FN4 checks, audited, never edited (FN5: reversal and a new entry).
  - Used for the first year's opening balances (FN3, from the accountant's last balance sheet) and for what no rule covers (for example accrued interest, FQ16).
  - Needs the whole nomenclature seeded (T100).
  - A `cash_book` entity's opening bank and cash balances stay blocked by FQ11, as today.
- **FCX4. Close run.** For a `ledger` entity, the owner runs "Préparer la clôture" for a fiscal year. Finance computes the year-end entries of FC1, FC2, FC4 and FC5 (FC6 once unblocked) and shows them before posting.
  - Each entry is `OD`, dated the last day of the fiscal year, one per kind (depreciation, subsidy release, batches in progress, stocks, provisions). Source `(finance, close:<kind>:<legal entity>:<year>, version)`.
  - Running again with the same figures posts nothing; with changed figures it posts a reversal and a new entry (FN7).
  - Once the run has posted, the count (FC3) and the current values are frozen, except a value still missing (FC4, FC5) on a batch or eggs line of the last day synced after the run: the owner types it once, so the run can post it and the year close (FCX6) is not refused forever.
  - Refused while the last month of the year is locked: year-end entries are never moved to another period, unlike FN5 corrections.
  - Refused for a `cash_book` entity, which has no balance sheet: it keeps the registers and schedules only.
- **FCX5. Reversal at opening.** The stock and batch-in-progress entries (FC4, FC5) and their provisions are reversed on the first day of the next fiscal year (`OD`), posted with that year's à-nouveaux. For a provision this has the same effect on the next year's result as a reversal at the next close.
  - If a close entry changes after the next year was opened, its à-nouveaux and these reversals are posted again by reversal and new entry (FN7). The opening always equals the closing.
- **FCX6. Year close.** After the close run and the accountant's approval (given outside the app: NQ7), the owner closes the year.
  - Every month of the year is locked (FN5, audited), and the year is marked closed with who and when.
  - The next year's à-nouveaux is posted (or posted again, FCX5).
  - Statements say "Projet" before the close and "Exercice clôturé le …" after it.
  - Reopening: owner only, audited. It unlocks the last month.

### Requirements
- **FC1. Fixed assets** (FQ9, FQ4, FQ27).
  - **Register,** per legal entity. An asset has:
    - label, category, farm and house (optional);
    - day acquired and day put into service;
    - cost in centimes, and an optional VAT amount typed from the invoice (FN9: excluded from the cost when the entity is VAT-registered);
    - residual value (0 when left empty);
    - **useful life in months, required, typed by the user** from the accountant's or the tax rules. No life or rate is stored or suggested;
    - how it was paid (cash, transfer, cheque issued, on credit) and an optional receipt;
    - for an asset bought before Dawra, "in the opening balance" with its accumulated depreciation at the start.
  - **`cash_book` entity** (FCX4): the register and the schedules only. Nothing is posted (acquisition, payment, disposal), and there is no later payment of a debt without 4481. Where its cash or bank payment for an asset goes in the cash book: FQ27.
  - **Categories:**
    - land (not depreciated);
    - buildings, poultry houses included;
    - technical installations, equipment and tools (SCOPE: feeders, drinkers, heaters, fans, cooling pads, generator, silos, scales, controllers);
    - transport equipment;
    - furniture and office equipment.

    Land, buildings, technical installations and transport equipment map to their accounts in 231x–234x; furniture and office equipment to 2351–2358. Each has its matching depreciation account, a leaf of 2832–2835 or 2834 (table in "Accounts from the PCA nomenclature").
  - **Acquisition posting:** D asset account (+ D 34551 for the VAT when registered, FN9) / C 5161 (`CA`), 5141 (`BQ`, an issued cheque on its issue day) or, on credit, 4481 Dettes sur acquisition d’immobilisations (`OD`; 1486 vs 4481: §9). A later payment of an asset bought on credit: D that account / C 5161 or 5141. An asset in the opening balance posts nothing: its cost and accumulated depreciation come with the opening entry (FCX3).
  - **Depreciation:** straight-line only. Depreciable base = cost − residual value.
    - **Default prorata (FQ9), to confirm with the accountant: by whole months.** The month the asset is put into service counts in full; the month of its disposal doesn't.
    - Months used in a fiscal year: from the in-service month (included) to the disposal month (excluded) or the year end, never beyond the life.
    - The charge of a year is cumulative(end) − cumulative(start), with cumulative(m) = base × min(m, life) ÷ life, rounded half up to the centime. Rounded once per cumulative figure, so the charges always add up to the base exactly (§7.1 fixture A).
    - An asset in the opening balance spreads what is left (base − accumulated depreciation entered) the same way over the life months left.
  - **Year-end posting** (close run): D 61932–61935 / C the depreciation leaves (283xx, 2834), one debit line per charge account and one credit line per depreciation account, paired as the CGNC pairs them (61932 / 2832x … 61935 / 2835x; table above).
  - **Disposal** (sold or scrapped): day, price (0 when scrapped), received in cash or at the bank. On the disposal day (`OD`):
    - the depreciation of the year up to the disposal month: D the asset's charge account (61932–61935) / C its depreciation account (283xx, 2834);
    - the asset leaves: D that depreciation account (accumulated), D 6513 VNA des immobilisations corporelles cédées, C asset account (cost);
    - the price: D 5161 / 5141 / C 7513 Produits des cessions des immobilisations corporelles.

    The close run counts only the months not yet posted.
  - **Screen** "Immobilisations": per asset, cost, accumulated depreciation and net book value; its schedule by year (charge, accumulated, net book value); forms to add and dispose.
  - **Out of scope:**
    - declining-balance depreciation, components, revaluation, intangible assets;
    - an asset paid by bill, or sold on credit;
    - depreciation in the batch cost (FN13 stays as built);
    - a value threshold under which purchases are expensed: the user decides what to register.
- **FC2. Loans and subsidies** (FQ16, FQ17).
  - **Loan:** lender, the bank account it is paid into (T32), principal, disbursement day, **annual rate typed from the contract** as an integer in 1/100 000 (5,55 % → 5 550; no float, FX1), monthly or quarterly, number of capital installments n, deferral periods d (interest only, default 0), first due day.
  - **Schedule:**
    - Due days are the first due day + k periods, the day clamped to the month's end.
    - During the deferral the capital is 0. Then capital = principal ÷ n rounded half up, and the last installment takes what is left.
    - **Default (FQ16): interest per period** = outstanding × rate ÷ (100 000 × periods per year), rounded half up, not counted by days.
    - Before confirming, the owner can change any row's capital and interest so the schedule matches the bank's table to the centime; the capital must add up to the principal. Confirmed rows are fixed (§7.1 fixture B).
  - **Postings:**
    - Disbursement: D 5141 (that bank account) / C 1481, `BQ`.
    - An installment marked paid by the owner or a manager (on or after its due day, as "Débité" in FN11): D 1481 capital, D 63111 interest / C 5141, `BQ`, on the day entered (default: the due day).
  - **Reminders and cash:** a reminder to owners and managers on the due day, once (a money notification, as for issued cheques). The `/treasury` 4-week cash schedule counts unpaid installments as outflows on their due day.
  - **Year end, default (FQ16):** no accrued interest. If the accountant wants it, it is a manual entry (FCX3).
  - **Investment subsidy:** label, granting body (free text), amount, day received, bank account, and the depreciable assets of the register it finances (one or more).
    - **Default (FQ17): posted when received,** D 5141 / C 1311, `BQ`.
    - **Release at the depreciation rate** (close run): released to date = subsidy × Σ cumulative depreciation of its assets ÷ Σ their depreciable bases, rounded half up; the year's release = that − what was released before. D 1319 Subventions d’investissement inscrites au compte de produits et charges, so that 1311 stays at the amount received (FQ17) / C 7577.
    - A subsidy on land or on no depreciable asset is refused (FQ17).
    - An asset disposed of before the end of its life: its depreciation stops at the disposal, and so does the release. What is not yet released stays on 1311 / 1319 (FQ28).
    - **`cash_book` entity:** the receipt is posted, as a loan's disbursement (the money comes in on its bank account, so it shows in the cash book); no release, since it has no close run (FCX4).
  - **Screen** "Emprunts et subventions": each loan's schedule with paid and due installments, and each subsidy with its release by year.
  - **Out of scope:** variable rates, early repayment, a renegotiated schedule (a new loan), loan fees and insurance (quick expenses), the short- and long-term split of the outstanding capital (presentation, FC8), operating subsidies, a loan paid straight to a supplier, the investment project file (§1).
- **FC3. Year-end count.**
  - **Count day:** the last day of the fiscal year.
  - **Count sheet,** printable from the browser (A4, in the user's locale), per farm. Each line has an empty "Compté" column, and the sheet carries no amount:
    - each open batch: house, production type, birds on hand (`flock`);
    - each stock item: kind, unit, lot and expiry, book quantity (`inventory`), expired lots flagged;
    - the egg stock (T113): one line per farm, in eggs, with its book quantity (SPEC-m3 E2 on that day).
  - **Entering the count:** owner or manager, online, a counted quantity per line. Saved by finance (`YearEndCount`: legal entity, fiscal year, lines), editable until the close run posts, audited.
  - **Gap** = counted − book, shown per line. Finance never writes another module's data: the screen links to the stock adjustment (S3, reason "inventaire") and to the daily entry (mortality), so the user corrects the books where they are kept. FC4 and FC5 value the counted quantities.
  - **Out of scope:** a count on another day, counting on a worker's phone, barcodes.
- **FC4. Batches in progress** (FQ19, FQ20).
  - **Scope:** batches of animals sold as meat (broiler, turkey, beldi, duck, quail, other) still open on the last day of the year. Pullets and layers are FC6.
  - **Cost engaged:** the batch's FN13 cost (chicks + valued consumptions + direct charges + allocated shared charges), counting only facts dated on or before the last day.
  - **Default (FQ19): no depreciation and no overheads in it, and a split by head.** The birds on hand carry cost engaged × birds on hand ÷ (birds on hand + birds sold before that day); the dead are carried by the survivors. Birds on hand come from the count (FC3) when entered, else from `flock` (§7.1 fixture C).
  - **Current value:** the owner can enter one.
    - **Default (FQ20), when none is entered:** birds on hand × the last average weighing (grams) × the farm's last sale price per kg for that production type (`sales`), or × the last price per head for a type sold by the head.
    - Without a weighing or a sale, the owner must enter a value.
  - **Posting** (close run):
    - D 31322 / C 71311 at cost;
    - when the current value is below cost, a provision for the difference: D 61961 / C 3913;
    - reversed on the next year's first day (FCX5): D 71311 / C 31322, and D 3913 / C 7196 Reprises sur provisions pour dépréciation de l’actif circulant.
- **FC5. Stocks** (FQ18, FQ20).
  - **Bought stock** (feed, vaccines, medicines, litter, gas, other, packaging included):
    - **Value:** counted quantity (else the book quantity) × the weighted average cost on the last day (S5, `inventory.valuate`), per item and farm.
    - **Accounts:** by kind (table "Bought stock by kind" above): D 3121, 31221, 31223 or a 3123 leaf / C the matching 6124 leaf, 612412, 61242 or 61243. Never C 6124 itself: it has sub-accounts (FN4).
    - **Current value, default (FQ20):** equal to cost, unless the owner enters a lower one for a damaged or expired lot (the count sheet flags expired lots). A provision for the difference: D 61961 / C 3912 Provisions pour dépréciation des matières et fournitures (§7 `stockAtCloseValue`).
    - Reversed on the next year's first day (FCX5): D the 6124 leaf / C the stock account, and D 3912 / C 7196.
  - **Eggs** (T113; `eggs` added to finance's dependencies by the product owner on 22 Nov 2026, CAPABILITY-MAP):
    - quantity: the count, else the egg stock (SPEC-m3 E2) on the last day: each record on the farm day it happened, whenever the server received it: the collections laid by then, the discards (the phone's farm day) and the draws (the sale's day) of a day by then, and the gradings of eggs laid by then (a grading only moves eggs between items);
    - **default (FQ18): value per egg typed by the owner**, in dirhams to the centime, no computed cost. Value = quantity × value per egg, exact. The run refuses while eggs to post have no value; none counted, nothing posted;
    - D 3152 Produits finis (d’animaux) / C 71321, in the "stock" entry, reversed with it (FCX5). With the PCA off, 3152 lands on 315, which has sub-accounts: nothing posts for the eggs and no value is asked, listed "non comptabilisé (FQ25)" (§9).
  - **Out of scope:** any valuation method other than the weighted average cost (S5).
- **FC6. Laying hens and pullets: decided default, to review** (FQ7, FQ8, §9 "Decided defaults"; T114, T115). Page numbers are the PCA 2015's, as printed.
  - **Method (FQ7a): classic by default.** The PCA treats breeding animals "au même titre que les immobilisations corporelles" (p. 88); the simplified method applies "par dérogation" (p. 89). One method per category of breeding animals, never both for the same category (p. 88). The owner may choose the simplified method for a fiscal year before the year's first entry ("permanence des méthodes", like FN1), stored with the other accounting choices. Ledger entities only.
  - **Built (T114, T115, 2026-11-23):** the method is `LegalEntity.hensMethod`, on `/settings/accounting`; the close run's `hens` entry (not reversed at the opening) carries each method's year-end lines, and `/closing` takes the owner's figures (life and cull value per laying flock, classic; current value per bird, simplified). Deviation, to review: under the classic method the removal at a cull is posted in that year-end entry, not on the cull day, as it needs the owner's figures. Left for later: a change of method between years (balances not converted), a pullet batch sold as pullets, a layer batch placed as day-old chicks with a price (taken as point-of-lay hens bought).
  - **PCA off:** the hens accounts are PCA-only (23711, 23712, 23962, 28371, 7151 / 7152, 7187; §5 "PCA off"), so FC6 stays "non valorisés" until FQ25 is answered.
  - **Classic method** (T115; FQ7b, FQ7c, FQ8):
    - balance-sheet accounts 23711 Animaux Reproducteurs Adultes and 23712 … Jeunes de Renouvellement, never 2371 / 2372 (FQ7b);
    - own pullets' rearing cost (the pullet batch's FN13 cost to date): at year end for pullets still rearing, D 23962 / C 71431 (pp. 89–90);
    - at the transfer to lay (SPEC-m3 B13): D 23962 / C 71431 for the cost not yet capitalised, then D 23711 / C 23962 for the batch's whole balance on 23962 (FQ7c: an asset in progress is cleared into its asset account on completion, p. 90);
    - point-of-lay hens bought: D 23711 (+ D 34551 for the VAT, FN9) / C 4481, 5141 or 5161, instead of 612121 (CGNC p. 147);
    - depreciation: straight line from the entry into 23711, base = entry value − the cull value typed by the owner, life = the laying period in months typed by the owner, FC1's whole-month prorata (pp. 36–37). D 61937 D.E.A des Animaux / C 28371 Amortissements des animaux reproducteurs (pp. 58, 124; §7 `straightLine`);
    - culled hens sold: C 7187 Produits de cessions courantes d’éléments d’actif instead of 712121 (p. 132);
    - removal at the cull (FQ8): D 28371 (accumulated) + D 6187 VNA des éléments d’actif cédés (cessions courantes) (net book value) / C 23711 (gross), never 6513 (p. 123). A whole flock lost without a sale: the net book value goes to 6513 (CGNC p. 147). A partial cull of share s: s of the gross and of the accumulated depreciation leave, and the schedule goes on over (1 − s). A provision on 2937, if any: D 2937 / C 7194 on the cull day.
  - **Simplified method** (T114), on the fiscal year's last day:
    - D 23711 / C 7151 for the laying flocks and D 23712 / C 7152 for the pullets certain to lay: birds counted (FC3) × entry value per bird (acquisition cost, or FN13 production cost for birds reared on the farm; p. 52);
    - the previous year's value reversed in the same run: D 7151 / C 23711 and D 7152 / C 23712 (p. 131, "Parallèlement");
    - a provision D 6194 / C 2937 for max(0, entry value − current value), the current value typed by the owner and required (p. 52). 6194 is subdivided like 6193 (61942, 61943; CGNC scan p. 296, PCA p. 124) but seeded as a leaf: T114 seeds them and posts to 61943 D.E.P. pour dépréciation des immobilisations corporelles (FN4);
    - no depreciation (p. 89).
- **FC7. Home consumption** (FQ21, FQ11).
  - **Recording:** birds or eggs taken by the exploitant, an associate or an employee are recorded on the sale forms (V2, V6, V7) with the kind "Consommation" and who took them. Offline, like a sale. The withdrawal blocks (V3, V6) apply for food safety, and birds on hand and the FIFO egg draws move as for a sale. No buyer, payment or receivable.
  - **Value:** quantity × a price, typed as on a sale. **Default (FQ21): prefilled with the farm's last sale price for the same product;** the owner can change it. Workers never see it (I5): they record the quantities, and the server values their entry at that last sale price. A product never sold yet has no price: FQ31.
  - **Batch result:** it counts with the batch's sales and kg sold at that value (FN13).
  - **Posting** (`OD`), credit 7140 Production Autoconsommée, under 714 Production Autoconsommée et Immobilisations produites par l’entreprise pour elle-même (confirmed by T100). With the PCA off, 7140 lands on 714, which has sub-accounts: §9. Debit:
    - 4463 for an associate of a company;
    - **default (FQ21):** 61713 Indemnités et avantages divers for an employee (a benefit in kind, under 6171);
    - the exploitant's account for an individual, **blocked by FQ11**. Until then the record is kept and listed as "non comptabilisé (FQ11)" on `/books`, for the month of its day.
  - **With the PCA off** no line goes on 714 (FN4) and no account is invented: the record is listed as "non comptabilisé (FQ25)" the same way. The debit follows who took it, whatever the legal form; a `cash_book` entity posts it too, as its sales.
  - **Out of scope:** the payroll side of a benefit in kind (CNSS, income tax).
- **FC8. Statements** (FQ22).
  - **Draft balance sheet** (buildable): from the trial balance on the last day, after the close run. Classes 1–5 by 3-digit account, debit balances as assets and credit balances as liabilities, and the net result of classes 6–7 as its own line. That result equals the draft CPC's net (U16). Labelled "Projet" until the year close (FCX6).
  - **Official statements** (T116; FQ22 decided defaults, to review, §9): `/closing/statements`, for a fiscal year, from the posted lines.
    - The CGNC's simplified model (CGNC Tome I scan p. 51 bilan, p. 52 CPC), or the PCA's simplified model when the entity has the PCA overlay (PCA Annexe B, PDF p. 181 bilan, p. 182 CPC). Every entity with the ledger gets it: no gate on revenue; above the PCA's 10 M DH the page says the normal model applies (out of scope).
    - Bilan: gross, amortissements et provisions, net, and N-1's net; CPC: the year and N-1. N-1 shows when that year has entries.
    - ETIC: the tables the ledger can fill. S1 (fixed assets) and S1 bis (amortissements) by the bilan's postes; with the PCA, S1-1 (biological assets in fixed assets) and S1 ter (biological assets in stock). Start = the à-nouveaux, increase and decrease = the year's other debits and credits.
    - "Projet" watermark until the year close (FCX6), then "Exercice clôturé le …". Printable from the browser (print CSS; no PDF dependency).
    - Each line lists its accounts by number prefix, as data with its page references (`finance/domain/official-statements.ts`); an account goes to the line with its longest matching prefix. Every class 1–7 posting account of both charts has exactly one line (unit test).
    - Labels: the printed French; Arabic translated, to review (FQ12).
    - `cash_book` entity: no statements (FCX4); the page says so.
  - **Checks:** Σ assets = Σ liabilities, result included; the CPC's net equals the balance sheet's result.
  - **Out of scope:** the tax return (liasse fiscale, IS / IR), the normal model, cooperative statements (§6).
- **FC9. Bank reconciliation.**
  - **Manual** (buildable now; the bank-fees category is T119), per bank account (T32), by the owner or a manager:
    - enter a statement: end day and closing balance as printed;
    - tick each 5141 line of that account that is on it;
    - book the lines on the statement but not in the books where they belong: bank fees through a new quick-expense category "Frais bancaires", D 61473 Frais et commissions sur services bancaires / C 5141, `BQ` (T119); the rest through its own form or a manual entry (FCX3).
    - The screen shows the statement balance, the book balance on the end day, the unticked book lines and the difference. The account is "rapproché" when the difference is 0.
    - A tick is audited, and can be undone until its month is locked.
  - **Statement import** (T117; decided default, to review, §9 "Bank statement import (T117)"), on the same screen, by the owner or a manager:
    - **MT940** (SWIFT customer statement), the one format both offered by Moroccan banks (Attijariwafa, Crédit du Maroc, Bank of Africa) and published field by field; **CSV** exports read with the owner's column mapping (separator, header lines, date column and format, label, a signed amount or a debit and a credit column, decimal comma), for banks that only give spreadsheets. No second file format: AMB 120 is offered but unpublished; CFONB 120 and camt.053 aren't offered by the banks found. Study and sources: `docs/studies/bank-statement-formats.md`.
    - A preview first, nothing saved; then each statement in the file becomes the account's statement of its end day (created, or one typed by hand with the same closing balance), and its lines are stored as printed. MT940: opening + Σ lines = closing on every page, MAD only, one account per file. CSV: the owner types the end day and closing balance.
    - Idempotent: a line is keyed by its statement and a hash of what the bank printed (with its rank among identical lines), so the same file again adds nothing; a file contradicting a statement already there is refused whole.
    - Each imported line is shown with the book line of the same amount it pairs with (ticked on this statement, else the nearest one still to tick, up to the end day), or "absente des livres". The owner ticks it (above); nothing is ticked automatically.
    - The file is untrusted: 512 KB at most, a text extension, no binary, UTF-8 or Windows-1252, parsed field by field, never executed.
  - **Out of scope:** automatic matching rules, cash-box counts.
- **FC10. Accountant import format** (FQ10; T118; decided default, to review). A `ledger` entity's month also downloads as a FEC, the "fichier des écritures comptables" of article A47 A-1 of the French LPF: the only journal-entry file found with a published specification, imported by EBP (Morocco edition) and Sage 100 (template seen in its French edition), and documented by Cegid. Its 18 fields are, in the same order, those of the Moroccan FEC of CNC avis n° 24 (2023), which fixes no technical format. Tab-separated, UTF-8 without BOM, CRLF, field names on the first line, dates `AAAAMMJJ`, decimal comma; FN18's party, farm, house and batch follow the 18 fields; named `FECAAAAMMJJ.txt` (the month's last day). Study, sources and every field choice: `docs/studies/accountant-import-format.md`. A vendor-specific format waits for a published specification.

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
| `splitShared` | `allocate` by the entity's key (FN14); bird-days when no batch has any weight by it | 3 900,00 by 31 000 / 12 800 m²·days → 2 760,27 / 1 139,73; by 600 / 100 kg sold → 3 342,86 / 557,14 |
| `breakEvenPrice` | planned cost ÷ planned kg | 270 800,00 ÷ 23 700 → 11,43 |
| `weightedAverageCost` | (value + cost in) ÷ (qty + qty in) | 9 200,00 for 2 000 kg + 36 950,00 for 8 000 kg → 4,615 DH/kg |
| `ageingBucket` | today − due date | due 20 Aug, today 5 Nov → 77 days → 61–90 |
| `thresholdUsage` | (booked + planned) ÷ threshold | 4 260 450 + 690 000 → 4 950 450; 99 % |
| `straightLine` (M6) | cumulative(m) = (cost − residual) × min(m, life) ÷ life, half up; charge = cumulative(end) − cumulative(start) (FC1) | hens 252 000 − 90 000, life 14 months, 7 months → 81 000,00; generator: §7.1 A |
| `loanSchedule` (M6) | capital = principal ÷ n half up, last = remainder; interest = outstanding × rate ÷ (100 000 × periods), half up (FC2) | 900 000 / 28 quarters → 32 142,86, last 32 142,78; 9th quarter: 642 857,12 × 5,55 % ÷ 4 → 8 919,64; short loan: §7.1 B |
| `subsidyRelease` (M6) | subsidy × Σ cumulative depreciation ÷ Σ base, half up, minus what was released before (FC2) | 14 205,00 on §7.1 A's generator → 2026: 676,43; 2027: 2 029,29 |
| `batchInProgressValue` (M6) | cost engaged × on hand ÷ (on hand + sold); provision = cost − current value when positive (FC4) | §7.1 C |
| `stockAtCloseValue` (M6) | min(cost, current value), provision = difference | 98 400 vs 97 300 → 97 300, provision 1 100,00 |
| `ristourne` (coop) | ops × voted ÷ total member ops | 412 000 × 220 000 ÷ 6 950 000 → 13 041,73 |

### 7.1 M6 worked fixtures

Computed by hand in centimes, then checked with a bigint script. Lives, prices and amounts here are **test inputs**, not reference values: in the app the user types them (FC1, FC2). The 5,55 % rate is the demo farm's (canvas). "Half up" rounds a positive amount to the nearest centime, 0,5 going up.

**A. Straight-line depreciation with the default prorata (FC1, FQ9).** Generator, put into service on 18 Sep 2026; cost 47 350,00, residual value 0, life 84 months (typed by the user); fiscal year January–December.
1. Base = 4 735 000 centimes. Months used: 2026 = September to December = 4 (September counts in full); 2027–2032 = 12 each; 2033 = 84 − 4 − 6 × 12 = 8 (January to August).
2. cumulative(m) = 4 735 000 × m ÷ 84, half up:

| Year | m at year end | 4 735 000 × m ÷ 84, centimes | cumulative, centimes | Charge, DH (D 61933 / C 28332) |
|---|---|---|---|---|
| 2026 | 4 | 225 476,19 | 225 476 | 2 254,76 |
| 2027 | 16 | 901 904,76 | 901 905 | 6 764,29 |
| 2028 | 28 | 1 578 333,33 | 1 578 333 | 6 764,28 |
| 2029 | 40 | 2 254 761,90 | 2 254 762 | 6 764,29 |
| 2030 | 52 | 2 931 190,48 | 2 931 190 | 6 764,28 |
| 2031 | 64 | 3 607 619,05 | 3 607 619 | 6 764,29 |
| 2032 | 76 | 4 284 047,62 | 4 284 048 | 6 764,29 |
| 2033 | 84 | 4 735 000 | 4 735 000 | 4 509,52 |

3. Check: 2 254,76 + 4 × 6 764,29 + 2 × 6 764,28 + 4 509,52 = 47 350,00, the base exactly. The net book value at the end of 2027 is 47 350,00 − 9 019,05 = 38 330,95.
4. Subsidy on this asset (`subsidyRelease`): 14 205,00 → 2026: 1 420 500 × 225 476 ÷ 4 735 000 = 67 642,8 centimes → 676,43; 2027: 1 420 500 × 901 905 ÷ 4 735 000 = 270 571,5 centimes → 2 705,72 released to date, − 676,43 = 2 029,29.

**B. Loan with equal capital repayments (FC2, FQ16).** Principal 100 000,00, disbursed 15 Jan 2027, 6 quarterly installments, no deferral, rate 5,55 % (5 550), first due day 31 Mar 2027.
1. Due days: 31 Mar, 30 Jun, 30 Sep, 31 Dec 2027, 31 Mar, 30 Jun 2028 (the 31st clamped to the month's end).
2. Capital = 10 000 000 ÷ 6 = 1 666 666,67 → 16 666,67; the last one = 100 000,00 − 5 × 16 666,67 = 16 666,65.
3. Interest = outstanding × 5 550 ÷ (100 000 × 4) = outstanding × 0,013875, half up:

| # | Due | Outstanding before | Interest | Capital | Installment | Outstanding after |
|---|---|---|---|---|---|---|
| 1 | 31/03/2027 | 100 000,00 | 1 387,50 | 16 666,67 | 18 054,17 | 83 333,33 |
| 2 | 30/06/2027 | 83 333,33 | 1 156,25 (1 156,2499…) | 16 666,67 | 17 822,92 | 66 666,66 |
| 3 | 30/09/2027 | 66 666,66 | 925,00 (924,9999…) | 16 666,67 | 17 591,67 | 49 999,99 |
| 4 | 31/12/2027 | 49 999,99 | 693,75 (693,7498…) | 16 666,67 | 17 360,42 | 33 333,32 |
| 5 | 31/03/2028 | 33 333,32 | 462,50 (462,4998…) | 16 666,67 | 17 129,17 | 16 666,65 |
| 6 | 30/06/2028 | 16 666,65 | 231,25 (231,2497…) | 16 666,65 | 16 897,90 | 0,00 |

4. Totals: capital 100 000,00; interest 4 856,25 (the same as 100 000,00 × 0,013875 × (6 + 5 + 4 + 3 + 2 + 1) ÷ 6); installments 104 856,25.
5. Entries: disbursement D 5141 / C 1481 100 000,00 (`BQ`). Installment 1 paid: D 1481 16 666,67, D 63111 1 387,50 / C 5141 18 054,17 (`BQ`). At 31 Dec 2027: 1481 = 33 333,32 credit; 63111 for 2027 = 4 162,50; 2028 = 693,75.

**C. A batch in progress at year end (FC4, defaults FQ19, FQ20).** Broiler batch open on 31 Dec: 10 000 chicks placed, 2 000 sold before 31 Dec, 400 dead, 7 600 on hand (counted). Cost engaged to 31 Dec 182 400,00; last average weighing 2 100 g; the farm's last sale price 8,50 DH/kg.
1. At cost: 18 240 000 × 7 600 ÷ (7 600 + 2 000) = 14 440 000 → 144 400,00.
2. Current value: 7 600 × 2 100 g = 15 960 kg; × 8,50 = 135 660,00.
3. Provision = 144 400,00 − 135 660,00 = 8 740,00.
4. Close run, 31 Dec (`OD`): D 31322 / C 71311 144 400,00; D 61961 / C 3913 8 740,00. Next 1 Jan (`OD`, FCX5): D 71311 / C 31322 144 400,00; D 3913 / C 7196 8 740,00.

## 8. Success criteria

### Finance core, end of M2

1. All §7 M2 fixtures pass. A property test posts random sequences of M1 events and checks that the trial balance is always balanced and that replaying the same sync twice changes nothing.
2. The pilot farm closes a batch and its margin and cost per kg match the owner's own calculation.
3. An expert-comptable has reviewed the seeded charts and the FN6 posting rules, and imported one month of export into their software.
4. Tenant isolation and the "worker never sees money" rule are covered by integration tests on every finance endpoint.

### Accounting close, end of M6

1. Every §7 M6 fixture and §7.1 A–C passes. Property tests:
   - for any asset (cost, residual, life, in-service and disposal days), the yearly charges add up to the base;
   - for any loan, the capital adds up to the principal;
   - running the close twice with the same facts posts nothing;
   - the trial balance stays balanced after the close run, the year close and the opening reversals.
2. After the year close, the next year's à-nouveaux equals the closing balance sheet (classes 1–5) plus the year's result on 1191 / 1199. It stays equal when a close entry is changed later (FCX5).
3. A pilot company closes a fiscal year in Dawra: the count, the close run, the draft balance sheet and CPC. An expert-comptable compares them with their own closing, and every difference is explained.
4. An expert-comptable has reviewed the accounts added by T100 and the FC posting rules, and answered or accepted the defaults of FQ9 and FQ16–FQ21.
5. Roles are covered by integration tests on every M6 endpoint: workers get nothing; the accountant reads and downloads, and every write is refused; owner-only actions are refused to managers.

## 9. Open questions for the expert-comptable

| # | Question | Blocks |
|---|---|---|
| FQ1 | Is the PCA (CNC opinion n° 7, 2015) mandatory, or a recommended project? | Default overlay (FN1) |
| FQ2 | Official account list of the cooperative chart (arrêté 441-01) | Cooperative ledger (FN1, CO1) |
| FQ3 | Can a cooperative combine the cooperative chart with PCA accounts? | Cooperative profile |
| FQ4 | VAT on feed, chicks, live birds, eggs; when is a farm VAT-registered? | FN9, FC1 (an asset's VAT) |
| FQ5 | Exact conditions of the 5 M DH agricultural exemption (3-year rule) and the cooperative IS threshold | FN17 |
| FQ6 | An individual taxed on real net income (RNR): ledger required? | FN1 |
| FQ7 | Laying hens: classic or simplified method by default? For the simplified method, confirm the valuation basis and the balance-sheet account the PCA text gives (§5 "Laying hens, what the text says": 23711 / 23712 or the text's 2371 / 2372); at the transfer to lay, does 23962 move to 23711? | FC6 (decided default, to review: classic, 23711 / 23712, yes; "Decided defaults" below) |
| FQ8 | Culled hens under the classic method: how is the remaining book value removed next to 7187? | FC6 (decided default, to review: D 28371 + D 6187 / C 23711; "Decided defaults" below) |
| FQ9 | Depreciation prorata: by month or by day? | FC1 (default in §5: by whole months) |
| FQ10 | Import formats of the accounting software used by the firms | FN18, FC10 (decided default, to review, 2026-11-23: the FEC of article A47 A-1 LPF, `docs/studies/accountant-import-format.md`; confirm the firm's software imports it, and whether a file per month suits it) |
| FQ11 | Account for the individual exploitant's contributions and withdrawals, and counter-account of a `cash_book` entity's opening bank and cash balances | FN3, FN6, FCX3, FC7 (an individual's entry) (decided default for contributions and withdrawals, to review, 2026-11-24: 1117 Capital personnel, PCA p. 72; §9 "Associate contributions". FN3's opening counter-account and FC7 still wait) |
| FQ12 | Is there an official Arabic version of the CGNC and PCA account labels? | FX5 |
| FQ13 | Journal for cheques and bills received (`EF` here): common practice? | FN6 |
| FQ14 | Payroll postings: the validated month in OD on its last day (61711 / 61741 against 3431, 4441, 4432), wages paid D 4432; advances beyond a worker's pay left on 3431? | plan-m4 pay |
| FQ15 | Cash book refused for companies and GIEs (law 9-88): right, and for which other forms? | FN1 |
| FQ16 | Loans: interest per period as annual rate ÷ periods per year, or counted by days as some banks do? Interest accrued at year end (intérêts courus) booked by Dawra, and on which account? | FC2 (default in §5: per period, not accrued) |
| FQ17 | Investment subsidies: booked when granted (a receivable) or when received? Released through 1319 / 7577? Treatment of a subsidy on land or on no depreciable asset? | FC2 (default in §5: when received, released to 7577, refused on land) |
| FQ18 | Eggs in stock at year end: how is their production cost per egg computed? | FC5 (default in §5: value per egg typed by the owner) |
| FQ19 | Cost of a meat batch in progress at year end: only FN13's costs, or also depreciation and overheads? Split between birds sold before the close and birds on hand: by head or by weight? | FC4 (default in §5: FN13 cost, by head) |
| FQ20 | Current value for the provision test of batches in progress and stocks: what evidence is accepted (last sale price × last weighing, market price, the owner's estimate)? | FC4, FC5 (default in §5: last weighing × last sale price; stocks at cost unless lowered) |
| FQ21 | Home consumption: 7140 Production Autoconsommée is in the PCA (T100); which account with the PCA off, where 714 has sub-accounts? Valued at cost or at selling price? An employee's share on 6171 (61713 Indemnités et avantages divers)? | FC7 (default in §5: last sale price, 61713) |
| FQ22 | The official simplified model (bilan, CPC, ETIC) and the PCA's biological-asset tables: the text, each line's accounts, and the revenue limit of the simplified model (10 M DH?) | FC8 official statements (decided defaults, to review: "Official statements (T116)" below) |
| FQ23 | An asset bought on credit: 4481 Dettes sur acquisition d’immobilisations (passif circulant) or 1486 Fournisseurs d’immobilisations (dettes de financement), and from what term? | FC1 (default in §5: 4481) |
| FQ24 | The PCA subdivides four accounts the M2 rules post to: 3421 (34211, 34212, 34217, 34218), 3424, 4411 (44111, 44117, 44118) and 6136 (61361, 61365 → 613651 Honoraires des vétérinaires, 613657, 61367). Which leaf should each rule use, and do the Agrégés / Agrégateur sub-ledgers matter for the pilot? The same for three CGNC splits left out the same way (§9 "FN4 sweep"): 3121 (31211 / 31212, groupe A / B), 5161 (51611 Caisse centrale, 51613 / 51614 succursale A / B) and 6134 (61341, 61343, 61345, 61348, by the policy's kind). | FN6 rules (T100 and the FN4 sweep left these sub-accounts out) |
| FQ25 | With the PCA off, these PCA accounts land on a CGNC account that has sub-accounts, so no line can go there: 3152 → 315, 7140 → 714, 23711 → 23, 28371 → 283, 23962 → 239, 7151 / 7152 → 71, and 7187 → 718 (culled hens, FC6; not in the CGNC, §9). Also 31322 (batches in progress) → 3132, which the seed keeps `cgnc` though the CGNC has no 3132 (§9). Which CGNC account for each? | FC5 eggs, FC6, FC7 with the PCA off |
| FQ26 | Packaging in stock: 31231 Emballages perdus, 31232 Emballages récupérables non identifiables or 31233 Emballages à usage mixte (egg trays, sacks)? | FC5 |
| FQ27 | A `cash_book` entity's cash or bank payment for a fixed asset: which category or line in the cash book (FN16)? | FC1 (until then a `cash_book` entity keeps the register and the schedules only, and posts nothing) |
| FQ28 | An asset financed by an investment subsidy is sold or scrapped before the end of its life: is the part of the subsidy not yet released taken to income on the disposal day (on 7577 or another account), and is 1311 then cleared against 1319? | FC2 (until then the release stops with the asset's depreciation and the rest stays on 1311 / 1319) |
| FQ29 | Bought stock with the PCA off: vaccines and medicines are bought on 6122 (612123's CGNC fallback). Are they in stock on 3121 / 61241 like feed, or on 31221 / 61242 like the other supplies? §5's "Bought stock by kind" covers only the PCA case. | FC5 (until then they follow their purchase family: 31221 / 61242) |
| FQ30 | Bought stock of a VAT-registered entity: valued net of the purchases' VAT (as the charges were booked, FN9)? The batch cost (FN13) still uses amounts including VAT. | FC5 (until then net of VAT) |
| FQ31 | Home consumption of a product the farm has not sold yet (first eggs of a grade, first birds by the head): FQ21's last sale price doesn't exist. Which value? | FC7 (until then such an entry, a worker's or one whose price was left empty, is valued 0: it counts in the batch's kg sold, posts nothing and is listed "non comptabilisé" on `/books`) |
| FQ32 | 5 M DH tracker: which planned sales count next to the booked ones, so a sold batch isn't counted twice? | FN17 (decided default, 23 Nov 2026: a budget may be linked to an open batch of the organisation. A batch's latest linked budget counts its planned sales less that batch's sales recorded so far, never below 0, while the batch is open, and 0 once it is closed; a budget with no batch counts in full when saved during the fiscal year (a budget has no planned sale date). Linking to a planned batch (`planning`) is not offered) |

### Decided defaults, to review

Decided from the official texts on the owner's instruction (2026-11-23), built or specified, and to review with the accountant. PCA pages are as printed in `docs/sources/plan-comptable-agricole-2015.pdf`; CGNC pages are scan pages of the Tome I (below).

- **6193 is subdivided; FC1 posts to its sub-accounts** (FN4). The CGNC lists 61931 D.E.A. des terrains, 61932 D.E.A. des constructions, 61933 D.E.A. des installations techniques, matériel et outillage, 61934 D.E.A. du matériel de transport, 61935 D.E.A. des mobilier, matériel de bureau et aménagements divers and 61938 D.E.A des autres immobilisations corporelles under 6193 (scan p. 296; OCR lines 1948–1964). PCA chapter 6 repeats them and adds 61936 D.E.A des Plantations and 61937 D.E.A des Animaux (pp. 123–124). Seeded: the six CGNC ones `cgnc`; 61936 and 61937 `pca`, both falling back to 61938, since plantations (236) and animals (237) are PCA rubriques with no CGNC account and 238 Autres immobilisations corporelles is the CGNC's catch-all (its depreciation 2838, its charge 61938). These come from chapter 6, an exception to "Chapter 6 only" below: the CGNC prints the subdivision itself. FC1's charge follows the asset's depreciation account: 2832 → 61932, 2833 → 61933, 2834 → 61934, 2835 → 61935 (2838 → 61938 when a category uses it; land is not depreciated). The year-end entry has one debit line per charge account. Until this change every depreciation posted on 6193, a parent; no pilot has run, so no production entry needs moving.
- **FN4 sweep: every rule account is a posting account, checked against the CGNC** (2026-11-23). Every account a posting rule uses (FN6, FN9, FN11, FC1–FC9, payroll, loans, subsidies, the close and the à-nouveaux) was checked against the CGNC normal model (scan pages below, read on the page image) and the PCA. Where the CGNC subdivides one, the sub-accounts are seeded `cgnc` with the printed labels and the rule posts to the leaf that matches its meaning; `accounts.test.ts` proves every rule account is a leaf in both charts. The PCA nomenclature lists all of these undivided; its chapter 6 repeats several subdivisions, as #187 found for 6193.
  - 6196 → 61961 D.E.P. pour dépréciation des stocks, 61964 … des créances de l’actif circulant (scan p. 297; PCA pp. 103, 124). FC4 / FC5 provisions on 3912 and 3913 post to 61961: "Les comptes 3911 à 3915 sont crédités par le débit du compte 61961" (PCA p. 103). The opening reversal (FCX5) still takes them back on 7196, a leaf (scan p. 307).
  - 6311 → 63111 Intérêts des emprunts, 63113, 63114, 63115, 63118 (scan p. 298; PCA p. 124). FC2's bank-loan interest posts to 63111.
  - 6171 → 61711 Appointements et salaires, 61712, 61713 Indemnités et avantages divers, 61714, 61715; 6174 → 61741 Cotisations de sécurité sociale, 61742–61745 (scan p. 294; PCA pp. 121–122). The pay's gross posts to 61711, the employer's CNSS contribution to 61741, and an employee's home consumption (FC7, FQ21) to 61713, since personnel pay is "en numéraire ou en nature" (PCA p. 121). This replaces T100's "Chapter 6 only" exclusion of 61711–61715 (§9 below): the CGNC nomenclature prints them.
  - 6147 → 61471, 61472, 61473 Frais et commissions sur services bancaires (scan p. 293; PCA p. 120). FC9's bank fees post to 61473.
  - 3455 → 34551 État – TVA récupérable sur immobilisations, 34552 … sur les charges (scan p. 279). FN9's VAT on purchases and quick expenses posts to 34552 (as FN9 intended), an asset's VAT (FC1) to 34551. PCA chapter 6 describes 3455 as one account (pp. 100, 104, 107); the leaves roll up to it.
  - 5111 → 51111 Chèques en portefeuille, 51112 Chèques à l’encaissement; 5113 → 51131 Effets échus à encaisser, 51132 Effets à l’encaissement (scan p. 286). FN11 knows the instrument's state: a cheque received posts to 51111, remitted to the bank D 51112 / C 51111 (a remittance now posts an `EF` entry), cashed D 5141 / C 51112; a bill remitted D 51132 / C 3425. PCA p. 110 says 5111 holds "à la fois" both states: the two leaves add up to it.
  - 7131 → 71311 Variation des stocks de biens produits en cours, 71312, 71317; 7132 → 71321 Variation des stocks de produits finis, 71322, 71327 (scan p. 305). Batches in progress (FC4, 31322 under 3132 Encours de production) post to 71311; eggs (FC5, 3152 Produits finis) to 71321.
  - 2332 → 23321 Matériel, 23324 Outillage (scan p. 266). The equipment category's asset account is 23321; 23324 has no category yet, like 61938.
  - 2832 → 28321 … des bâtiments, 28323 … des constructions sur terrains d’autrui, 28325, 28327, 28328; 2833 → 28331 … des installations techniques, 28332 … du matériel et outillage, 28333, 28338; 2835 → 28351 … du mobilier de bureau, 28352 … du matériel de bureau, 28355 … du matériel informatique, 28356, 28358 … des autres mobilier, matériel de bureau et aménagements divers (scan pp. 271–272). Each category's depreciation account is the leaf of its kind (table in §5); its charge stays the 6193x of the 283x (61932–61935), one debit line per charge account. 2834 has no sub-account. `/assets` still groups the categories by the 4-digit account.
  - Also seeded, though no rule posts there, so a manual entry (FCX3) uses the CGNC's leaves: 6191 → 61911, 61912 (scan p. 295); 6192 → 61921, 61922, 61923, 61928; 6194 → 61942, 61943; 6195 → 61955, 61957 (p. 296); 6198 → 61981, 61984 (p. 297); 7197 → 71971–71978; 7198 → 71981, 71984 (p. 307). 7196 is not subdivided (p. 307).
  - **Left leaves on purpose, as T100 did for FQ24.** 3121 → 31211 / 31212 Matières premières (groupe A / B) (scan p. 275) and 5161 → 51611 Caisse centrale, 51613 / 51614 Caisse (succursale ou agence A / B) (scan p. 287) are the entity's own groups or branches, the same kind as 34211 / 34212 and 44111 / 44112 "catégorie A / B" (pp. 278, 282). 6134 → 61341 Assurances multirisques, 61343 … Risques d’exploitation, 61345 … Matériel de transport, 61348 Autres assurances (scan p. 291; PCA p. 117) splits by the policy's kind, which a quick expense doesn't record, as 6136 does (FQ24). These sub-accounts are not seeded, so the rules keep posting to 3121, 5161 and 6134 (FQ24).
  - Unchanged: the rule accounts the PCA relabels from a CGNC number (§9 "CGNC numbers the PCA relabels") keep T100's `pca` tags, so their CGNC parents (6121, 6122, 6125, 6126 …) stay leaves without the PCA, though the CGNC subdivides 6126 into 61261–61263 (scan p. 290).
  - Every other rule account is a leaf in the CGNC: 1191, 1199, 1311, 1319, 1481, 2340, 2834, 31221, 31223, 3424, 3425, 3431, 3912, 3913, 4415, 4432, 4441, 4455, 4463, 4481, 5115, 5141, 6513, 7196, 7513, 7577 (scan pp. 258, 266, 272, 275, 278, 281–287, 307; OCR lines 528–561, 2086 and 2489–2509 for 1311, 1319, 1481, 6513, 7513 and 7577). The PCA accounts (612xxx, 712xxx, 23111, 23231, 233111, 31322, 3152, 7140 …) are leaves in the seed.
- **FQ7a. Method: classic by default.** Breeding animals are treated "au même titre que les immobilisations corporelles" (p. 88); the simplified method applies "par dérogation aux principes du CGNC" (p. 89). One method per category of breeding animals, never both (p. 88). The owner may choose the simplified method before the year's first entry; ledger entities only (FC6).
- **FQ7b. Balance-sheet accounts 23711 (adults) / 23712 (young replacement stock), never 2371 / 2372.** 2371 is subdivided (p. 56), so it takes no line (FN4), and 2372 is Animaux de service (pp. 56, 89). The 4-digit numbers of p. 131 read as a drafting error: their labels are those of 23711 / 23712, and of 7151 / 7152 (p. 69).
- **FQ7c. Yes: at the transfer to lay, 23962 is cleared into 23711.** An asset in progress on 239 is cleared to its asset account on completion (p. 90).
- **FQ8. Removal at the cull: D 28371 (accumulated) + D 6187 (net book value) / C 23711 (gross).** 6187 records "la valeur nette comptable restante au moment de la cession des animaux reproducteurs" (p. 123), next to 7187 for the price (p. 132); never 6513 for a cull. A whole flock lost without a sale: the net book value goes to 6513 (CGNC p. 147). A partial cull removes the culled share of the gross and of the accumulated depreciation. A provision on 2937, if any, is reversed D 2937 / C 7194 on the cull day.
- The entries of both methods are in §5 FC6.
- **FC6, removal at a cull posted at the year end (T115, 2026-11-23).** Under the classic method the removal (D 28371 + D 6187 or 6513 / C 23711) is posted in the close run's `hens` entry, on the fiscal year's last day, not on the cull day: it needs the laying period and the cull value the owner types at the close. The year's statements are the same; a month's books between the cull and the year end don't show it yet.
- **FC6, a change of method between years converts nothing (T114, T115, 2026-11-23).** The method is the entity's current choice when an event or a close posts. Switching classic → simplified leaves the classic balances (23711, 28371, 23962) as they are, and the simplified close reverses only a simplified entry; later versions of old placements and sales are posted by the new rules (FN7). The accountant converts the balances by manual entry (FCX3).
- **FC6, a layer batch placed with a price is a purchase of point-of-lay hens (T115, 2026-11-23).** Under the classic method any layer batch not transferred from pullets and placed with a chick price posts D 23711 / C 4481, even when the birds are day-old chicks; their rearing is then not capitalised. Rearing your own layers goes through a pullet batch and the transfer to lay (SPEC-m3 B13).
- **Placement debts: paid per placement (2026-11-23).** A placement has no supplier record (the hatchery and the delivery note are free text, SPEC B1), and a supplier payment (S2) only settles inventory purchases, so the debt of a placement's purchase (C 4411, or C 4481 for point-of-lay hens under the classic method, FC6) could not be paid. The owner or the manager (`finance.record`, as every payment) pays it per placement on `/treasury` ("Poussins et poulettes à payer", the hatchery's name on the line): D the account the placement's standing entry credited / C 5161 (`CA`) or 5141 (`BQ`, an issued cheque on its issue day), tagged with the cash box or bank account, source `placement:<batch>:pay:<payment>` (FN7, tagged with the batch for FN18). Online, audited, the id from the form (a second send posts once). Capped at what is still owed: the standing entry's credit less the payments already posted for it; refused `NOTHING_OWED`, `PAID_MORE_THAN_OWED`, `TREASURY_ACCOUNT_MISMATCH`. A `cash_book` entity pays too, unlike an asset (FC1, FQ27): its placement posted the 4411 debt, and the money leaving shows in its cash book as a supplier payment's does. No 4411 balance per hatchery (no supplier record, FQ24's sub-ledgers): to review with the accountant, with a supplier record on placements if the pilot needs one. A change of the hens method after a payment (FC6 above) reposts the debt on the other account and leaves the payment where it was; the accountant moves it by manual entry (FCX3).
- **M1 other costs: kept as they are, no new ones (FN13, 2026-11-24).** T24's "other cost" of a batch (`BatchCost`, SPEC B6) posted nothing, so a cost entered there never reached the books. Since FN13 a cost of the batch is a quick expense charged to it (`/expenses`), which posts (FN6) and counts as a direct cost. The batch screen lists the batch's old other costs read-only, with a link to `/expenses` while the batch is open; the `flock.recordBatchCost` mutation stays, so an old phone's cost is refused `USE_EXPENSES` rather than `UNKNOWN_MUTATION`. The rows recorded before are real past costs: they still count in the batch's cost per kg at closing (B6) and in its result (FN13's `other`), and are not migrated into expenses, which would post them now into a month that may be locked. They stay out of the ledger: the accountant adds a manual entry (FCX3) if one belongs in an open year.
- **Placement VAT: on top of the price (FN9, FC6, 2026-11-24).** The placement form takes an optional VAT amount for the delivery, on top of chicks × price (the price per chick is typed before VAT), stored on the batch (`chickVatCentimes`, null when none was typed). The placement's purchase posts D 612121 (or 23711, point-of-lay hens under the classic method) for the price, D 34552 (chicks, a charge) or 34551 (hens, a fixed asset as FC1) for the VAT, and C 4411 (or 4481) for both; an entity not VAT-registered keeps the VAT in the charge or the asset. The placement debt (§9 "Placement debts") is that credit, so it includes the VAT. The field is shown to everyone who places a batch, as on expenses, purchases and sales: the phone doesn't know the entity's registration, and the posting ignores the VAT apart when it isn't registered (FQ4). A turkey placement split by sex is one delivery: its VAT goes on the first batch. The batch result's chick cost (FN13) and the cost per kg locked at the batch's closing (SPEC B6) include this VAT whatever the entity's registration, as FQ30's default counts management figures with VAT (a budget copied from the batch carries it in its other costs). The simplified hens' entry value (FC6) is the hens' value as posted: price alone for a registered entity, which recovered the VAT, price + VAT otherwise; the classic method already reads it from 23711.
- **Production cost without recoverable VAT (FC6, 2026-11-24).** Where a batch's FN13 cost becomes an accounting value (the classic pullets' rearing cost on 23962 / 71431, the transfer to lay on 23711, the simplified pullets' entry value), a VAT-registered entity takes out the VAT it recovers on that batch: the placement's and that of the expenses charged to it. The CGNC values a production cost without recoverable taxes. An entity not registered keeps FN13's cost, VAT included (FQ30). Not taken out, to review: any VAT in the valued consumptions (inventory's cost) and in the batch's share of shared expenses.
- **Credit expenses: paid per expense (2026-11-24).** A quick expense recorded "à payer plus tard" posts C 4411 (FN6) with no supplier and no due date, and nothing paid it. The owner or the manager (`finance.record`) now pays it on `/treasury` ("Dépenses à crédit à payer": category, day, note, account, what is still owed), as a placement (above): D the account the expense's entry credited (4411) / C 5161 (`CA`) or 5141 (`BQ`, an issued cheque on its issue day), tagged with the cash box or bank account, source `expense:<expense>:pay:<payment>` (FN7; tagged with the expense's batch for FN18), label "Paiement fournisseur : " and the expense's note, or "dépense du <day>" without one. Online, audited (`Expense` `pay`), the id from the form, rate-limited, a locked month refused (FN5). Capped at what is still owed: the entry's credit less the payments posted for it; refused `NOTHING_OWED` (also for an expense paid in cash or at the bank), `PAID_MORE_THAN_OWED`, `TREASURY_ACCOUNT_MISMATCH`. A `cash_book` entity pays too (its expense posted the 4411 debt). No supplier and no due date added to the expense: it is due on its own day; a supplier on quick expenses waits for FQ24's sub-ledgers.
- **Cash schedule: debts without a due date (2026-11-24).** The 4-week schedule on `/treasury` (F-Effects) left out three debts the books hold: a placement's chicks or point-of-lay hens still owed (above), an asset bought on credit (4481 still owed, `payFixedAsset`'s cap, FC1) and a quick expense on credit (above). They now count as payments out, each for what is still owed, due on its own day (the placement day, the acquisition day, the expense's day): none records terms, so a debt is due from the day it arose, and a late one lands in the first week, as an inventory purchase without a due date already does. Facts only, as before: nothing paid off, nothing to come.
- **Associate contributions and withdrawals; FQ11 for the exploitant (2026-11-24).** The owner (`finance.manage`) records on `/treasury` ("Apport ou retrait de l'associé", or "… de l'exploitant" for an individual) money an associate or the exploitant brings in or takes out: day, amount, direction, the cash box or bank account (required: the money moves on it), and for an associate a free-text name (no associate record; the label carries it). A contribution posts D 5141 (`BQ`) or 5161 (`CA`) / C the owner's account, a withdrawal the reverse, tagged with the cash box or bank account, source `associate:<id>`, label "Apport de l'associé : <name>" / "Retrait de l'exploitant"… Online, audited (`AssociateAccount` `contribution` | `withdrawal`), the id from the form (a second send posts once), rate-limited, a locked month refused (FN5). The account by legal form:
  - **individual: 1117 Capital personnel** (FQ11 decided from the PCA): it "représente la différence entre la valeur des éléments actifs et […] passifs que l'entrepreneur individuel a décidé […] d'inscrire au bilan" and "est crédité du montant des apports de l'entrepreneur au début ou en cours d'activité […] et débité des prélèvements de toute nature effectués par l'entrepreneur" (PCA p. 72; nomenclature 111 Capital social ou personnel, p. 53; a CGNC account, seeded, a leaf). The PCA's 7140 text names a "Compte de l'exploitant" (p. 130) without a number; 1117 is the only account the chart gives for it. No separate drawings account: class 11 of the PCA (p. 53) and of the CGNC has none, so 1117 takes both.
  - **company, GIE, association: 4463 Comptes courants des associés créditeurs**, "crédité du montant des fonds laissés par les associés à la disposition de l'entreprise à titre temporaire" (PCA p. 107), as FC7 debits an associate's home consumption.
  - **indivision and cooperative: 4463 too**, to review: an indivision's co-owners hold shares (`coOwnerShares`) as associates do, and a cooperative keeps the CGNC until FQ2. A contribution to the social capital (1111) is the accountant's manual entry (FCX3), not this form.
  - Every books profile posts it (`cash_book` too: the money moves on 51xx, so it shows in the cash book). No cap on a withdrawal: a 4463 left in debit is the accountant's to reclassify (3468 Autres comptes d'associés débiteurs). The chart screen lists both accounts (F-Chart). FN3's opening counter-account for a `cash_book` entity and FC7's exploitant home consumption are not changed by this decision: they can now use 1117, each as its own task.
- **Posting overrides (FN8, 2026-11-24).**
  - **Which rules.** FN6's charges and revenues (class 6 or 7): chicks, feed, vet products, litter, gas, birds and eggs sold, salaries, the employer's CNSS and the six quick-expense categories. Balance-sheet accounts (4411, 3421, 5141, 5161, cheques, bills, VAT, pay debts) stay as the rules say: the treasury, the debts, the cheque portfolio and the VAT read them by number, and an entity's own sub-accounts of them are FN3's job.
  - **Keyed by the rule's account.** An override replaces the rule's default account (the PCA number the rule holds) wherever a rule posts it, so the "other" item kind follows litter (both 61221) and medicine follows vaccines (612123).
  - **The replacement.** A posting account (FN4) of the entity's chart when saved, in the default's class: a charge stays a charge, a revenue a revenue. If the chart later loses it (the PCA switched off with no entry in the new year, FN1), the default applies again, mapped as usual (FN2), and the screen says so.
  - **"New entries only" read as new sources.** A source record first posted after the override takes it. A later version of a source first posted before it (FN7: reversal and new entry) keeps the overrides in force at its first posting: an edited amount or a batch closing never moves an old purchase to another account, and the months already sent to the accountant don't change ("changing a rule never rewrites posted entries", ADR-010 §3). So the overrides are kept as an append-only history, and the source's first entry's time picks the ones in force. Unlike FC6's method, which changes only between years, an override can change mid-year. Quick expenses post once, with today's overrides.
  - Not overridden: the close, loans, assets, subsidies and placement payments, whose accounts are not FN6 rules (M6), and manual entries (FCX3), where the owner already picks the account.

### FN14 allocation keys: decided defaults, to review (2026-11-23)

- **House m² counts the days of presence.** A batch weighs its house's m² × the days of the service period it was in the house, from placement to the closing day: a batch present half the month takes half its house's weight. Plain m² would charge a batch placed on the 30th like one present all month.
- **Kg sold is the live (farm) weight sold in the service period**, from the flock's sales records, the weight FN13 divides by. A batch that sells in the next month takes none of this month's charges by this key.
- **A batch with no weight gets nothing; when no batch has any** (kg sold in a month without sales, for example), the line is split by bird-days instead, and `/results` says so under the batch. With no bird-days either, nothing is split, as before.
- **Rounding stays FN14's largest remainder (§7 `allocate`)**: parts rounded down, the centimes left go to the largest remainders, so the parts always sum to the line.

### Bank statement import (T117): decided default, to review (2026-11-23)

The owner asked (2026-11-23) not to wait for the pilot's statement files: study the published formats, build, list the choices here. Study, sources (URLs, read 2026-11-23) and every reading choice: `docs/studies/bank-statement-formats.md`.

- **MT940 built**, from bank-published implementations of the SWIFT standard (ING format description v6.0, 1 Aug 2023; Citi Handlowy MT940 export guide, 25 Jan 2023); SWIFT's own handbook is behind a login. Offered by Attijariwafa (SWIFT, EBICS), Crédit du Maroc (e-Corporate download) and Bank of Africa (Trans Doc).
- **No second format.** AMB 120 (Attijariwafa, Crédit du Maroc) has no published specification; it may be CFONB 120, but no source says so. camt.053 and CFONB 120 are offered by no Moroccan bank found. To do when a bank gives its AMB 120 specification.
- **CSV with the owner's mapping**, no bank layout assumed. XLS isn't read: saved as CSV first.
- **Reading:** 20YY years; the booking (entry) date when given, else the value date; C / RD +, D / RC −, a D balance negative; MAD only, 2 decimals; each page balances; pages joined; one account per file; the statement is the account's statement of the closing day (T111's key), and a CSV's end day and closing balance are typed by the owner.
- **Fixtures are synthetic** (`src/modules/finance/fixtures/bank/`): to check against the pilot's first real files (their :86: layout, entry dates).

### Official statements (T116): decided defaults, to review (FQ22, 2026-11-23)

The product owner asked (2026-11-23) for the most logical reading of the official texts, built, each choice listed here for the accountant. Sources: CGNC Tome I scan pages (OCR in `docs/sources/cgnc-tome-I-statements.ocr.txt`, the page images checked for the tables) and the PCA PDF pages (`docs/sources/plan-comptable-agricole-2015.pdf`).

- **Revenue limit: the texts disagree.**
  - Loi 9-88, art. 21 (scan p. 13): revenue ≤ 7,5 M DH is exempt from the ESG, the TF and the ETIC.
  - CNC avis n° 1 of 26 July 1993 (scan pp. 67–68): revenue ≤ 7,5 M DH follows the simplified model and presents only its bilan and CPC.
  - PCA 2015 (PDF p. 17 §H.1, p. 18 §B.4, p. 19 §B.7): "simplifications prévues dans le droit commun", the simplified model below 10 M DH, and only the bilan and the CPC up to 10 M DH. No other text in the sources gives the 10 M DH, which probably comes from a later amendment of loi 9-88.
  - Default: the simplified model for every `ledger` entity, gated on nothing. Above 10 M DH of revenue (lines 1 + 2) the page says the normal model applies (out of scope, FC8).
- **Which model.** The CGNC simplified bilan and CPC (scan pp. 51–52) without the PCA overlay. With it, the PCA's Annexe B (PDF pp. 181–182). The PCA bilan only adds "Plantations" and "Animaux immobilisés". The PCA CPC follows the normal model's cascade: exploitation, financier, courant, non courant, impôts. It adds "Variation d'inventaire (animaux immobilisés)" (715) and details the financial and non-current lines.
- **Line ↔ accounts.** The bilan's masses, rubriques and postes are the 1-, 2- and 3-digit numbers of classes 1–5 (scan p. 156). The simplified model keeps the rubriques and reduces the postes through "divers" postes and rubriques without detail (scan pp. 171–172). So:
  - a normal poste goes to the simplified poste of the same number when there is one: 223, 231–234, 311, 342, 346, 349, 441, 446, 449, 511, 514, 516, 554;
  - otherwise it goes to its rubrique's "divers" poste (the simplified plan's 117, 227, 237, 317, 347, 447, scan pp. 316–339), or to the rubrique when that has no detail (13, 14, 15, 24/25, 35, 45);
  - 552 and 553 go to "Crédits d'escompte et de trésorerie" (the simplified plan's 552/553).
- **Amortissements et provisions** sit on the poste the simplified plan gives them: 2823 and 2831–2834 on their poste, 2836 / 2936 and 2837 / 2937 on Plantations / Animaux (PCA). 281 goes to the non-valeurs. 282 and 283 otherwise go to the "diverses" postes. The simplified plan keeps 292, 293, 294/295, 391, 394, 395 and 59 undivided (2920, 2930, 2940, 3910, 3940, 3950, 5900). So 3911, 3942 and 3946 go on their poste, and the rest is shown on the rubrique line (immobilisations, trésorerie) or on the "divers" poste (stocks, créances).
- **Not in the simplified bilan, added when non-zero:** écarts de conversion (17, 27, 37, 47), as scan p. 171 asks, and comptes de liaison (16). They are hidden when zero.
- **Result.** "Résultat net de l'exercice" is the CPC's net. 119 holds last year's result until it is allocated (FN3's à-nouveaux puts it on 1191 / 1199), so it is shown with 116 and 118 on "Reports à nouveau et résultats nets en instance d'affectation".
- **Signs.** Each account stays on its poste of origin with its sign (a supplier in debit reduces "Fournisseurs"). The one exception is a bank in credit (514), shown on "Banques (soldes créditeurs)": the model has both postes. The draft bilan on `/books` (T110) moves classes 3–5 by sign instead.
- **CPC (CGNC).** Line 5 prints "Subventions d'exploitation" and "Autres produits d'exploitation" together. The simplified plan has no 716 (scan pp. 316–339), so 716 has its own half-line. "Opérations concernant les exercices précédents" (column 2) isn't split out: column 3 only, and N-1.
- **ETIC** (simplified: S1–S7, scan p. 54; PCA: S1–S9, PDF p. 179). Avis n° 1 and the PCA (above) exempt these entities, so the tables are shown for information. Only the tables the ledger can fill are shown:
  - S1 by the bilan's postes (scan p. 55), with increases and decreases in total. The acquisition / production / transfer split needs each asset's history (FC1 register), not the ledger.
  - S1 bis with the amortissements only (28).
  - With the PCA, S1-1 (PDF p. 185): animals 237 and 23962, plantations 236 and 23961.
  - With the PCA, S1 ter (PDF p. 187): animaux adultes 316 and 3171, animaux en cours 31322, plantations en cours 3131 and 31321. "Plantations matures" has no stock account in the PCA: left empty.
  - Opening = the à-nouveaux entry (FN3's `opening:` source). In the first year kept in Dawra, the opening balances come in a manual entry (FCX3), so they count as increases.
  - S2–S9 (disposals, provisions, sûretés, TVA, capital, allocation, tax result, aggregation) are left to the accountant.
- **Arabic.** No official Arabic version of the models in the sources (FQ12). The Arabic labels are translations, to review.

### Found for the accountant (T100)

From reading the PCA text (`docs/sources/plan-comptable-agricole-2015.pdf`; line numbers of a `pdftotext -layout` extract, page numbers as printed).

The CGNC is checked against the Code Général de la Normalisation Comptable, Tome I (CNC), "Cadre comptable et plan de comptes": linked as "Code Général de la Normalisation Comptable : TOME I et TOME II" from the CNC standards page of finances.gov.ma. The scan is image-only and not in the repository; the OCR of scan pages 250–340 is in `docs/sources/cgnc-tome-I-p250-340.ocr.txt` (`docs/sources/README.md`). Pages cited below are scan pages: the normal model is pp. 256–315, the simplified model pp. 316–339. A number the OCR misses was checked on the page image.

- **Left out of the seed: 14 printed rows.** FN4 refuses a line on an account with sub-accounts, so the accounts the M2 rules post to must stay leaves (checked by `accounts.test.ts`). Moving those rules to a leaf is its own task once the accountant answers FQ24. The rows left out:
  - under 3421 Clients: 34211 Clients – catégorie A, 34212 Clients – catégorie B, 34217 Clients Agrégés, 34218 Client Agrégateur;
  - under 3424 Clients douteux ou litigieux: "34211 Clients douteux ou litigieux" and "34217 Clients douteux ou litigieux Agrégés". These are misprints that repeat 3421's numbers (p. 60), and the text gives no other number for them;
  - under 4411 Fournisseurs: 44111 Fournisseurs, 44117 Fournisseurs Agrégés, 44118 Fournisseur Agrégateur;
  - under 6136 Rémunérations d’intermédiaires et honoraires: 61361 Commissions et courtages, 61365 Honoraires, 613651 Honoraires des vétérinaires, 613657 Autres Honoraires, 61367 Frais d’actes et contentieux.
- **Chapter 6 only.** Subdivisions that chapter 6 cites but the nomenclature doesn't list are not seeded. Example: 61711–61715 under 6171 (p. 121), which would also make the salaries rule's account a parent. Superseded where the CGNC nomenclature prints the subdivision itself: 6193 (#187) and the FN4 sweep's accounts, 61711–61715 included ("Decided defaults").
- **Misprints in the nomenclature, corrected from chapter 6:**
  - "152. Provisions pour charges" (p. 54) is 155: its accounts are 1551–1558, and chapter 6 heads it "155. PROVISIONS POUR CHARGES" (p. 79);
  - "240. Prêts immobilisés" (p. 57) is 241: its accounts are 2411–2418, and chapter 6 says "241. Prêts immobilisés" (p. 90);
  - the second "281. Amortissement des immobilisations incorporelles" (p. 58) is 282, and "282. Amortissements des immobilisations corporelles" is 283: their accounts are 2821–2828 and 2831–2838, and chapter 6 lists 281, 282, 283 (p. 93).
- **Grouped rows.** "24/25. Immobilisations financières", "294/295. Provisions pour dépréciation des immobilisations financières" and "613 / 614. Autres charges externes" have no separate label anywhere in the text (chapter 6 uses the same grouped headings). Each number is seeded with the printed label, so 241 and 248 roll up to 24, 251 and 258 to 25, 2941 and 2948 to 294, 2951 and 2958 to 295, 6131–6137 to 613 and 6141–6149 to 614. Doubtful: the accountant may prefer other labels.
- **Labels.**
  - The 70 accounts seeded before T100 keep their labels. Where they differ from the print, the difference is typographic only: case of the class and two-digit headings (for example "COMPTE DE FINANCEMENT PERMANENT" seeded as "Comptes de financement permanent"), "État" for the printed "Etat" (345, 3455, 445, 4455), and dashes.
  - New accounts use the printed label, with broken line wraps joined. The all-caps headings are in sentence case with their accents ("ECARTS" → "Écarts"). The text has no mojibake.
- **Which accounts are `pca`.** The PCA intro says it adapts the CGNC to agriculture (p. 4) but doesn't list the adaptations. T100, without the CGNC text, tagged an account `pca` when:
  - its label is agricultural (agricole, agrégés / agrégateur, animaux, végétaux, plantations, cultures, irrigation, autoconsommation, variation d’inventaire);
  - it sits under such an account;
  - it is part of a split with such an account;
  - or it must be `pca` so that a CGNC account a rule posts to stays a leaf.

  All other accounts were `cgnc`. A `pca` account's `fallback` is its nearest CGNC ancestor. The tags were then checked against the CGNC Tome I (above): 163 `pca`, 599 `cgnc`.
  - **Retagged `pca`: not in the CGNC.** Each number is absent from the page image of its class in the normal model, and from the OCR of the simplified model: 1136 (p. 258), 1353 (p. 259), 1602 (p. 261), 2317 (p. 265), 3153 (p. 277), 3917 (p. 281), 6187 (p. 295), 7162 and 7164 (p. 306), 7187 (pp. 306–307). Their fallbacks are 113, 135, 160, 231, 315, 391, 618, 716, 716 and 718. No rule posts to them. 7187 (culled hens, FC6) lands on 718 with the PCA off, which has sub-accounts (FQ25).
    - 1353 / 1354: the CGNC has 1354 Provisions pour investissements and 1355 Provisions pour reconstitution des gisements (p. 259), and so does PCA chapter 6. The PCA nomenclature prints 1353 / 1354 for them, so the seeded 1354 (`cgnc`) carries the label of CGNC 1355, and 1355 isn't seeded. Probably a misprint in the PCA nomenclature: which numbers should the seed use?
    - 7162 / 7164: the CGNC has 7161 and 7168 Subventions d’exploitation reçues des exercices antérieurs (p. 306), and PCA chapter 6 cites 7168. 7168 isn't seeded.
  - **Still `cgnc`, though not in the CGNC: 3132 Encours de Production.** CGNC 313 has 3131 Biens en cours, 3134 and 3138 (p. 276), no 3132. Retagged, 3132 would leave the chart without the PCA, and 31322 (batches in progress, FC4) would land on 313, which has sub-accounts there. So the tag stays until the accountant names the CGNC account for batches in progress with the PCA off (FQ25).
  - **Only in the CGNC's simplified model:** 317 "Stocks divers" (p. 324; seeded with the PCA's label "Stocks provenant d’immobilisations") and 3468 Autres comptes d’associés débiteurs (p. 325). The normal model has neither. Their tags stay `cgnc`. 237, 2837, 3171 and 7140 below are in the same case.
  - **Settled as CGNC:** 714 Immobilisations produites par l’entreprise pour elle-même, with 7141–7148 (p. 306), 716 Subventions d’exploitation (p. 306), 6177 Rémunération de l’exploitant (p. 295), and 7385 (p. 308, read "1385" by the OCR).
  - **Settled as PCA additions:** 61213, 61228, 61268, 34111, 34131, 34171, 44211, 25812, 25882, 31323, 612413, 613112, 71214, 71224, 7112, and the "d’exploitation / hors exploitation" splits 23111, 23112, 23121, 23122, 23212, 23231 and 23232 (23211 is in the CGNC, below). These are absent from the OCR text; their page images weren't checked one by one.
  - **CGNC numbers the PCA relabels.** The CGNC has these numbers with a generic label. They keep T100's `pca` tag and the PCA label. For most of them this keeps their CGNC parent a leaf without the PCA, where a rule falls back: 2321, 3427, 6121, 6122, 6125, 6126, 7121, 7122, 7124, 7125 and 317. The list is CGNC label (scan page) → PCA label:
    - 23211 Bâtiments industriels (A,B…) (p. 265) → Bâtiments d’exploitation;
    - 3111 Marchandises (groupe A) (p. 275) → Marchandises agricoles;
    - 3131 Biens en cours, 31311 Biens produits en cours, 31312 Biens intermédiaires en cours (p. 276) → Avances aux cultures, … cycle long, … cycle court;
    - 3151 / 3152 Produits finis (groupe A / B) (p. 277) → Produits finis (Végétaux) / (d’animaux);
    - 34271 Clients – factures à établir (p. 278) → Clients factures à établir et créances sur travaux non encore facturables;
    - 6111 Achats de marchandises « groupe A » (p. 288) → Achats de marchandises agricoles;
    - 61211 / 61212 Achats de matières premières A / B (p. 289) → Achats de matières premières agricoles – Végétaux / – Animaux;
    - 61221 / 61222 Achats de matières et fournitures A / B (p. 289) → Achats de matières et fournitures / Denrées et Fournitures pour le personnel;
    - 61223 Achats de combustibles (p. 289) → Combustibles;
    - 61224–61227 and 61251–61254 (p. 289): the same label in both texts;
    - 61261 Achats des travaux, 61262 Achats des études (p. 290) → Travaux et façons pour les productions agricoles, Etudes;
    - 7111 Ventes de marchandises au Maroc (p. 303) → Ventes de marchandises agricoles au Maroc;
    - 71211 / 71221 Ventes de produits finis and 71212 / 71222 Ventes de produits intermédiaires (pp. 303–304) → Ventes de produits végétaux, Ventes d’animaux;
    - 71241 / 71251 Travaux and 71242 / 71252 Etudes (p. 304) → Ventes de services agricoles / non agricoles, au Maroc / à l’étranger;
    - simplified model only: 237 Immobilisations corporelles diverses (p. 321) → Animaux; 2837 Amortissements des immobilisations corporelles diverses (p. 322) → Amortissements des Animaux; 3171 Matières premières (p. 324) → Stocks d’animaux provenant d’immobilisations; 7140 Immobilisations produites par l’entreprise pour elle-même (p. 336) → Production Autoconsommée.

    Rule accounts among them: 23211 (buildings, FC1), 61221 (litter and "other"), 61223 (gas) and 7140 (home consumption, FC7). Without the PCA they post to 2321, 6122, 6122 and 714. Parents of rule accounts: 61212 (612121–612123), 61251 (612511, 612512), 61261 (612612) and 71212 (712121).
  - **The chart without the PCA is the seed's `cgnc` accounts, not the whole CGNC.** CGNC sub-accounts the PCA reuses (above) or doesn't print (23214, 23218, 1355, 7168) aren't in it, so 2321, 6121, 6122, 6125 and 6126 stay leaves there. A `cgnc` account's label is the PCA's, and some differ from the CGNC's: 1354, 317, 716, and 7113 (CGNC "Ventes de marchandises à l’étranger", p. 303; seeded "Ventes des autres marchandises"). The labels weren't compared one by one.
- **Laying hens.** The chapter 6 text for 715 names 2371 and 2372 as adults and young stock, while the nomenclature has 23711 / 23712 for them and 2372 for service animals (§5 "Laying hens, what the text says", FQ7).
