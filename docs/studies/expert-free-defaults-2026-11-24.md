# Study: decided defaults without the experts (vet, accountant, CNDP, prices, ONSSA)

_Read-only study, 2026-11-24, on the product owner's instruction of the same day: don't wait for the experts; read the official sources, decide, build; the demo on Vercel + Supabase comes first. Code read at `origin/develop`. Every web source below was accessed on 2026-11-24._

The study keeps one rule: **no domain figure without a source whose terms allow its use.** Where nothing official exists, the default is "empty, typed by the user, flagged unreviewed".

## Summary of decisions

| # | Topic | Decided default | Still needs a person or a licence |
|---|---|---|---|
| 1 | Vaccination protocol | Still no default schedule: no official programme exists. **New:** Gumboro, bronchite infectieuse, Marek, pullorose, salmonellose aviaire, Newcastle and peste aviaire are notifiable diseases (dahir 1-75-292, art. 1). The app shows the duty to declare (art. 3). Marek and H9N2 are added to the vaccine catalogue, because ONSSA-authorised vaccines exist for them. | The vet's programme for each farm, which ONSSA validates (3308-17, art. 13) |
| 1 | Withdrawal periods | No change: there is no official table. The ONSSA positive list has no withdrawal column. The value stays typed from the notice (AMM) or the prescription. | Nothing to build; the vet confirms the form's wording |
| 2 | Accounting | **Settled from the PCA text:** FQ16 (accrued interest is booked), FQ17 (subsidy on land; booking when granted is allowed), FQ19 (production cost includes depreciation and indirect production costs, **against the current default**), FQ23 (1486 when payment is due in more than a year), FQ30 (net of recoverable VAT, **confirms** the default). **Partly settled:** FQ1, FQ18, FQ20, FQ21, FQ28. | The rest: tax law (FQ4, FQ5, FQ6), the cooperative chart (FQ2, FQ3), the accountant's practice (FQ9, FQ10, FQ13, FQ24–FQ27, FQ29, FQ31) |
| 3 | CNDP | Each farm files: HR as F-113 under délibération 298-AU-2014, buyers as F-214 under 32-2015, suppliers as F-113 under 98-AU-2015, the sanitary register and biosecurity as F-211. The publisher files for its own processing and signs an art. 23 contract with each farm. Any foreign hosting needs an **F-118, even to the EU**. The US is **not** on the CNDP list. **The demo uses synthetic data only.** | The owner signs and files. A lawyer reviews. Hosting choice (OQ1). |
| 4 | Market prices | No official reusable feed exists: **manual entry stays** (T94/T95, already built). An optional link to FISA's monthly bulletin, with no data copied. | FISA's written permission before any import |
| 4b | T78 CNSS export | Stays blocked: the CNSS says the BDS specification is public, but no official download was found | The CNSS specification (or an affiliate's copy) |
| 5 | ONSSA register / checklist | **Gaps found:** a declaration line for notifiable diseases; installation requirements of 2127-05 art. 2 and 4 missing from the self-declaration (toilets, building specs, nets on openings, staff housing, layer egg store and droppings area, manure humidified before removal) | None to build them; ONSSA review stays "to review" |

Note on the brief's labels: market prices are **SPEC-m5 NQ3** (`market-prices`, MP1–MP3, T94/T95). **T78 / MQ3** is the CNSS declaration export (SPEC-m4 MQ3, `tasks/plan-m4.md`). Both are covered below (4 and 4b).

---

## 1. Vet review, Checkpoint F: vaccination protocol and withdrawal

### Findings

**What the repo already decided** (`docs/sources/onssa/README.md`, SPEC OQ4, SPEC-m3 MQ3/MQ4):
- Newcastle vaccination is compulsory for every production type (arrêté n° 3308-17, art. 13–14). The app gives a warning, never a block.
- No ONSSA programme exists; the templates stay empty with `reviewedByVet: false`.
- No withdrawal list exists; the value is typed on each treatment.

This study confirms all of that and adds the points below.

**F1. Notifiable poultry diseases: Gumboro and infectious bronchitis are on the list.**
- **Source:** dahir portant loi n° 1-75-292 du 5 chaoual 1397 (19 septembre 1977), édictant des mesures propres à garantir les animaux domestiques contre les maladies contagieuses.
  - BO n° 3388 du 5 octobre 1977, p. 1079.
  - Consolidated version of 4 January 2024, last amended by loi n° 61-22 (BO n° 7262 du 4 janvier 2024, p. 4).
  - URLs: https://adala.justice.gov.ma/api/uploads/2025/11/25/Dahir%20portant%20loi%20n%C2%B0%201-75-292%20%C3%A9dictant%20des%20me-1764082058086.pdf (consolidated); ONSSA copy: https://www.onssa.gov.ma/wp-content/uploads/2024/01/DAH.1-75-292.FR_c5.pdf.
- **Art. 1** lists, among the diseases "donnant lieu à déclaration et application des mesures de police sanitaire vétérinaire": « La peste aviaire, la maladie de newcastle, la maladie de Gumboro, la maladie de Marek, la pullorose (S.P.G), la salmonellose aviaire (salmonella enteridis et Salmonella typhimerieum) et la bronchite infectieuse chez la volaille ». It also lists « La psittacose-ornithose chez toutes les espèces d'oiseaux ».
- **Art. 3:** the owner or keeper of an animal "atteint ou soupçonné d'être atteint" must declare it immediately to the local administrative authority. Every vet who visits the animal must too.
- **Art. 4:** treatments or vaccinations around an outbreak may be prescribed, only with products whose use the ministry authorises.
- **Art. 5:** complementary measures per disease are set by arrêté.
- **The arrêtés that exist** (ONSSA page "Maladies animales", https://www.onssa.gov.ma/reglementation/reglementation-sectorielle/sante-animale/maladies-animales/) cover only three poultry diseases: Newcastle (3308-17), HPAI (2466-17) and pullorose (2836-17). Each one's **art. 1** has the declaration "immédiatement déposée auprès du service vétérinaire de l'ONSSA" of the place where the birds are.
- **No arrêté exists for Gumboro, infectious bronchitis or Marek.** They are notifiable, but no vaccination is compulsory for them.
- **H9N2 (low-pathogenic avian influenza) is not on the art. 1 list.** "Peste aviaire" is HPAI (the title of 2466-17). The 2016 mass H9N2 vaccination was reported only by the press (Medias24, 17/02/2016). No official text was found, so it is not cited as an obligation.

**F2. Authorised vaccines exist for Gumboro, IB, H9N2 and Marek. There is still no schedule.**
- **Source:** ONSSA, « Liste positive des médicaments vétérinaires », ONSSA/DIL/DPIV, 6 May 2025, 565 pages: https://www.onssa.gov.ma/wp-content/uploads/2025/05/LISTE-POSITIVE-DES-MEDICAMENTS-VETERINAIRES-06-MAI-2025.pdf.
- Read in full with pdftotext. Lines that name each disease:

| Search term | Lines |
|---|---|
| Newcastle | 96 |
| bronchite | 61 |
| Gumboro | 44 |
| bursite | 27 |
| H9 | 39 |
| Marek | 26 |
| laryngo | 7 |

- Examples, with their AMM numbers:
  - « ATLAVAC H9N2 », virus inactivé, AMM N° 1913.1/17/V4;
  - « CEVAC FLU H9 K », AMM N° 1905.3/17/V2;
  - « HIPRAGUMBORO GM 97 », AMM N° 0874.2/03/V4;
  - « POULVAC IB PRIMER ».
- Columns: company, product, date of the AMM, active ingredient, target species, validity, presentation, AMM number.
- **No withdrawal column, and no ages or schedule.**
- Footer: « Même si le délai de validité des AMM est dépassé, tous les produits officiellement enregistrés restent autorisés tant qu'ils n'ont pas fait l'objet de retrait officiel. »
- **Reading:** a vaccine **type** (Marek, H9N2) can be offered in the catalogue on the strength of this list. A schedule cannot.

**F3. Breeder-only texts: nothing for the grower's protocol.**
- Arrêté 2130-05 (S8), art. 9: vaccination against breeders' salmonelloses and mycoplasmoses follows "une stratégie élaborée … par la direction de l'élevage".
- Arrêté 2836-17 (S9), art. 15: SPG vaccination of breeders is prohibited.
- Already in the repo README.

**F4. Withdrawal periods.**
- Loi 49-99, art. 9 and 20: the "délais d'attente" of the prescriptions of use are binding. This is already cited.
- No official table exists. The positive list has no withdrawal column.
- ONSSA's "Médicaments vétérinaires" page publishes:
  - the positive list;
  - the registration guidance « Exigences relatives à l'enregistrement des médicaments vétérinaires au Maroc » (2024);
  - circulaire conjointe n° 1/94 (AMM dossier);
  - lois 21-80, 13-83, 24-09;
  - décret 2-82-541.
- It publishes **no** withdrawal or LMR table and no RCP/notice database: https://www.onssa.gov.ma/intrants-agricoles-ia/medicaments-et-intrants-veterinaires/medicaments-veterinaires/.
- **Where a withdrawal period can be read:** on each product's notice and RCP, which the vet or the box gives. That is what the form already says.

**F5. Licence.**
- No mentions légales or terms page was found on onssa.gov.ma.
- Loi n° 2-00 relative aux droits d'auteur et droits voisins, **art. 8**: « La protection prévue par la présente loi ne s'étend pas : a. aux textes officiels de nature législative, administrative ou judiciaire, ni à leurs traductions officielles ». Consolidated text: https://adala.justice.gov.ma/api/uploads/2024/12/13/Droits%20d'auteur%20et%20droits%20voisins-1734085207226.pdf.
- **Reading, not legal advice:** the arrêtés, the dahir and the positive list (an administrative list) are free to quote and to reuse as facts. Brand names stay trademarks: the catalogue uses generic vaccine types, not brands.

**Can a default protocol be built from official sources only? No.**
- No official text gives an age, a strain or a route for any poultry vaccine in Morocco.
- 3308-17, art. 13 puts the programme in the hands of the farm's vet, "validés par le directeur général de l'ONSSA".
- What the app shows instead is listed under "Decided default" below.

### Decided default

1. **Templates stay empty, `reviewedByVet: false`** (no change). The protocol editor already tells the owner to enter the programme of the vet sanitaire.
2. **The Newcastle warning stays** (no change).
3. **New: notifiable diseases.**
   - The health screens of a batch show a short card: « Maladies à déclaration obligatoire ».
   - It lists the 7 poultry diseases of dahir 1-75-292, art. 1, and psittacose-ornithose.
   - It states the duty: declare immediately a suspected case to the local authority (art. 3). For Newcastle, HPAI and pullorose, declare to the ONSSA veterinary service of the place (3308-17, 2466-17 and 2836-17, art. 1).
   - Static text, no workflow. A notifiable-disease workflow stays out of scope (SPEC-m2-compliance §1).
4. **New catalogue entries:** `vaccine-marek` and `vaccine-avian-influenza-h9n2` (kind `vaccine`, withdrawal `null`). Source: the ONSSA positive list of 6 May 2025. Generic names, no brand.
5. **Withdrawal:** no change. Typed from the notice (AMM) or the prescription (loi 49-99, art. 9).

### Builder tasks

| Task | Files | Acceptance criteria | Size |
|---|---|---|---|
| **V1. Notifiable diseases card** | `src/components/vaccinations.tsx` or the batch health section (`batches.tsx`), `messages/fr.json`, `messages/ar.json`; source text in `docs/sources/onssa/README.md` (new S12 row: dahir 1-75-292, consolidated 4 Jan 2024, both URLs) | The card shows on a batch's health section, offline. It lists the 8 diseases and the declaration duty with its sources: « Dahir n° 1-75-292, art. 1 et 3 ; arrêtés n° 3308-17, 2466-17 et 2836-17, art. 1 ». FR and AR strings. A component or e2e test asserts the source line. No new table. | S |
| **V2. Catalogue: Marek and H9N2** | `prisma/seed/reference/products.json`, seed test if any | Two new `vaccine` products with null withdrawal fields; `pnpm db:seed` idempotent; README S11 line says the positive list is the source of the vaccine types | XS |
| **V3. Source file for the dahir** | `docs/sources/onssa/DAH.1-75-292.FR.txt` (extracted text, like the others) | Text extracted from the ONSSA PDF with nothing changed. README row added. | XS |

### Truly blocked

- The vet's actual programme for each production type, and ONSSA's validation of it.
- The vet's wording check of the withdrawal form. That is Checkpoint F itself; the app no longer waits on it.

---

## 2. Expert-comptable review: posting rules and charts

Sources read: `docs/sources/plan-comptable-agricole-2015.pdf`, extracted with pdftotext. **Page numbers are the printed footers** ("NN. 01 décembre 2015"), the convention SPEC-finance already uses (1117 is on p. 72). The CGNC normal-model OCR `docs/sources/cgnc-tome-I-p250-340.ocr.txt` was also used. Each item below gives the reading, then what changes.

### Settled from the text

| FQ | The text | Reading | Change to build |
|---|---|---|---|
| **FQ16**, accrued interest | PCA p. 78 (rubrique 14): « Quant aux intérêts courus et non échus, générés par ces dettes, ils doivent être débités aux comptes correspondants du poste 631 "Charges d'intérêts", par le crédit du compte de régularisation passif 4493 "Intérêts courus et non échus à payer" ». p. 108: 4493 « enregistre, à son crédit, les montants des intérêts courus et non échus à la date de clôture sur les dettes, y compris celles de financement permanent ». | Accrued interest **must** be booked at the close. The current default ("no accrued interest") contradicts the text. Per-period vs by-day interest stays open (the text is silent). | **F1:** the close run posts, for each loan, the interest accrued from the last due day to the year end: D 63111 / C 4493. The opening reverses it (FCX5 pattern). Accrual = outstanding × rate × days ÷ (100 000 × 365), rounded half up. The day count is a default, to review. |
| **FQ17**, subsidies | PCA p. 75: « Les subventions d'investissement peuvent être, au choix de l'entreprise, soit prises en compte immédiatement en produits non courants, compte n° 7577, soit étalées par le biais du compte 1319 ». 1311 « sera crédité du montant de la subvention reçue par le débit du compte d'immobilisations, d'un autre compte de tiers ou d'un compte de trésorerie ». For non-depreciable assets, the release is « en fonction du nombre d'années pendant lesquelles les immobilisations non amortissables … sont inaliénables aux termes du contrat, ou, à défaut de clause d'inaliénabilité dans le contrat, d'une somme égale au dixième du montant de la subvention ». | (a) Spreading through 1319 / 7577 is one of two allowed options, so the current default stands. (b) Booking at the grant against a receivable ("un autre compte de tiers") is allowed. "When received" stays the default. (c) **A subsidy on land is not to be refused:** the text gives its release rule. | **F2:** accept a subsidy linked to land or to no depreciable asset. Store an optional "années d'inaliénabilité" (integer). The yearly release = subsidy ÷ years, else subsidy ÷ 10, until fully released, rounded half up, the last year taking the remainder. Remove the refusal and its error. Fixture in SPEC-finance §7.1. |
| **FQ19**, cost of a batch in progress | PCA p. 42, production cost of stocks: « des charges directes de production telles les charges de personnel, les services extérieurs, les amortissements …; des charges indirectes de production dans la mesure où il est possible de les rattacher raisonnablement ». For animal production, it includes « Les frais vétérinaires (pharmacie, soins) », « Les frais d'entretien (fourrage, paille, aliments consommés) » and « L'amortissement des bâtiments et matériels d'élevage ». It excludes, unless justified in the ETIC: « les frais d'administration générale de l'entreprise ; les frais de stockage des produits ; les frais de recherche et développement ; les charges financières ». Also excluded: losses, sub-activity, and distribution costs. | **The current default (no depreciation, no overheads) contradicts the text.** The cost of a batch in progress includes the depreciation of the houses and equipment it used, and the shared production costs FN14 already allocates. The split by head or by weight is not in the text and stays a default. | **F3:** FC4's cost engaged = FN13's direct costs + the batch's share of the year's depreciation charge of production assets (FC1 schedule; categories buildings 2832 / equipment 2833 by house, allocated with FN14's house-m² × days key) + FN14 shared charges, **excluding** expense categories tagged administration, financial (631x), selling. A flag on each category says whether it is a production cost. Fixture C updated. |
| **FQ23**, asset bought on credit | PCA p. 77: 1486 « enregistre à son crédit les acquisitions d'immobilisations dont le paiement n'intervient que dans plus d'une année. Celles qui sont acquises avec un délai de paiement inférieur à une année trouvent leur contrepartie … au compte 4481 ». p. 107 says the same for 4481. | The term decides it: up to 1 year → 4481; more than 1 year → 1486. | **F4:** the fixed-asset purchase on credit takes an optional last-payment day. If it is more than 12 months after the acquisition day, C 1486; otherwise C 4481 (the current behaviour). Payments debit the same account. The treasury schedule reads both. |
| **FQ30**, stock of a VAT-registered entity | PCA p. 41, cost of acquisition: « du prix d'achat facturé : augmenté des droits de douane et autres impôts et taxes non récupérables; diminué des taxes légalement récupérables telle la TVA "déductible" ». | Stock is valued **net of recoverable VAT**. This confirms the current default. | Docs only: mark FQ30 answered from the text, citing p. 41. |

### Partly settled

| FQ | The text | What it settles | What stays open |
|---|---|---|---|
| **FQ1**, PCA mandatory? | p. 4: « Le plan comptable agricole a été adopté par le CNC, réuni en Assemblée Plénière le 22 décembre 2015 ». The cover and every page header say « PROJET DE PLAN COMPTABLE AGRICOLE ». | The text is a CNC-adopted project. No text was found making it compulsory, so it stays an **optional overlay**, on by default (FN1 as built). | Whether a decree or a tax rule makes it compulsory: the accountant |
| **FQ18**, cost of eggs | p. 42: maintenance costs go into the hens' cost « sauf s'agissant des poules, ceux relatifs à la période de ponte, qui entrent dans le prix de revient des oeufs pondus ». | The cost basis of eggs is the laying period's production costs (feed, vet, labour, and depreciation per FQ19) spread over the eggs laid. The app can **suggest** a cost per egg. | Whether hens' depreciation (classic method) goes into the eggs: the text implies yes (it is a production cost), to confirm |
| **FQ20**, current value | p. 25: « La valeur actuelle d'un élément du patrimoine est une valeur d'estimation, à la date considérée, en fonction du marché et de l'utilité économique pour l'entreprise ». | A market-based estimate is the text's definition. The default (last weighing × last sale price) fits it. | What evidence the accountant accepts |
| **FQ21**, home consumption | p. 130: 7140 « est crédité de la valeur des biens et services fournis par l'entreprise en nature … à l'exploitant ou à sa famille, aux associés ou aux employés ». It is debited from the « Compte de l'exploitant ; Comptes courants d'associés ; Compte de charges de personnel (Avantages en nature) ». | The three debits match FC7 as built (1117 / 4463 / 61713). | Valuation basis (cost or price): the text says only "valeur". PCA off: the CGNC's 714 has only 7141–7148 (OCR lines 2319–2325), with no home-consumption account (FQ25). |
| **FQ28**, subsidy on a disposed asset | p. 75: « Le compte 1311 créditeur et le compte 1319 débiteur sont soldés l'un par l'autre lorsque le crédit du premier est égal au débit du deuxième ». | 1311 / 1319 are cleared against each other once fully released. | What happens to the unreleased part at a disposal: not in the text |
| **FQ9**, prorata | p. 94: for non-valeurs « il n'y a pas lieu d'utiliser le prorata temporis ». | It implies prorata temporis for the other assets. | Months or days: not in the text. Keep months. |

### Not settled by these sources

- **FQ2, FQ3:** the cooperative chart (arrêté 441-01) is not in `docs/sources`.
- **FQ4, FQ5, FQ6:** tax law (Code général des impôts), not the CGNC or PCA. They could be sourced from the CGI in a separate study; that was not requested here.
- **FQ10, FQ13, FQ14, FQ15:** practice and law 9-88.
- **FQ12:** no official Arabic labels found.
- **FQ22:** the texts disagree, already recorded.
- **FQ24, FQ25:** leaf choices for the accountant.
- **FQ26:** the PCA lists 31231–31233 without definitions; the CGNC's definitions are not in the OCR'd pages.
- **FQ27, FQ29, FQ31, FQ32.**

### Builder tasks

| Task | Files | Acceptance criteria | Size |
|---|---|---|---|
| **F1. Accrued interest at the close** (FQ16) | `src/modules/finance/domain/` (close rules, loans), seed check that 4493 is seeded as a leaf, SPEC-finance FC2 and §9 | The close run posts D 63111 / C 4493 per loan for interest accrued after the last due day. The opening entry reverses it. A loan with no time elapsed posts nothing. Fixture B extended with a year end. `accounts.test.ts` proves 4493 is a leaf. | M |
| **F2. Subsidy on non-depreciable assets** (FQ17) | finance subsidy domain + mutation, schema (optional `inalienableYears`), FR/AR, SPEC-finance FC2 | The old refusal is gone. The release is subsidy ÷ years (else ÷ 10) per year, the last year taking the remainder. A test proves the total release equals the subsidy. Mixed subsidies (depreciable + land): each part by its own rule. Migration additive. | M |
| **F3. Production cost of a batch in progress** (FQ19) | FC4 domain, FN14 allocation reuse, expense-category flag `productionCost`, SPEC-finance §7.1 fixture C | Cost engaged includes the house's depreciation share and the shared production charges. Categories flagged non-production (admin, financial, selling) are excluded. Fixture C recomputed by hand in the spec. Existing closes stay untouched (no re-post of a closed year). | L |
| **F4. 1486 vs 4481 by term** (FQ23) | FC1 purchase on credit, schema (optional `lastPaymentOn`), treasury schedule | More than 12 months → 1486, else 4481. Payments debit the account credited. Test at exactly 12 months (→ 4481). | S |
| **F5. Spec bookkeeping** | `SPEC-finance.md` §9 | FQ16, FQ17, FQ19, FQ23 and FQ30 marked "settled from the PCA text (2026-11-24), to review", with page numbers. FQ1, FQ18, FQ20, FQ21, FQ28 and FQ9 get their partial readings. | XS |
| F6 (optional). Suggested cost per egg (FQ18) | FC5 egg valuation | The count form prefills value per egg = the layer batches' laying-period costs ÷ eggs laid in the year. The owner may change it. | M |

### Truly blocked

- The accountant's sign-off on the readings above.
- The CGI-dependent items (FQ4–FQ6).
- The cooperative chart's official text (FQ2).

---

## 3. CNDP (loi n° 09-08)

### Findings (with citations)

**The texts**
- Loi n° 09-08, dahir n° 1-09-15 du 18 février 2009, BO n° 5714 du 5 mars 2009, p. 345.
- Décret n° 2-09-165, BO n° 5744 du 18 juin 2009, p. 1006.
- Consolidated text with the decree's articles in footnotes: https://adala.justice.gov.ma/api/uploads/2024/04/30/Protection%20des%20personnes%20physiques-1714464099884.pdf.
- CNDP « Procédure de notification des traitements », 24 July 2025: https://www.cndp.ma/wp-content/uploads/2025/07/CNDP_Procedure-de-Notification-des-traitements_20250724.pdf.

**Declaration or authorisation**
- **Art. 12:** a prior authorisation is needed for:
  - sensitive data;
  - a new purpose;
  - genetic data;
  - offences;
  - data with the CIN number;
  - interconnections.
- Otherwise, a prior declaration. The app stores no CIN (ADR-007).
- **Art. 1.3** counts health data as sensitive; **art. 21** says sensitive data needs the CNDP's authorisation. The app's work-accident records (WF13) are health data, so the HR processing needs an authorisation.
- **Art. 15** lists the content of a declaration:
  - the responsable;
  - purposes;
  - categories of persons and data;
  - recipients;
  - "les transferts de données envisagés à destination d'Etats étrangers";
  - retention;
  - the service for exercising rights;
  - security measures;
  - interconnections and "sous-traitance".
- **Timing:**
  - Art. 19: receipt within 24 h; processing may start once the receipt arrives.
  - Art. 20: within 8 days, the CNDP may move a file to the authorisation regime.
  - Décret art. 24: authorisations are decided within 2 months.

**Model délibérations** (simplified regime, art. 16, 17, 28.5). Spot-checked: the PDFs were downloaded and read for 236-2015, 298-AU-2014 and 32-2015.
- **298-AU-2014 of 11/04/2014, HR, private sector, model authorisation, form F-113.** https://www.cndp.ma/wp-content/uploads/2023/01/deliberation-n-298-AU-2014-11-04-2014.pdf
  - Art. 1 covers any employer subject to the code du travail, cooperatives included.
  - Purposes include « Gestion des arrêts maladie, des déclarations d'accident du travail ».
  - Art. 4 data include the CNSS number, salary, « avantages … en nature », training.
  - Art. 6 retention: not beyond "la durée nécessaire à la réalisation des finalités".
  - Art. 7: information of the employees, and consent or a derogation.
  - Art. 10: « Tout transfert de données à l'étranger doit être préalablement notifié à la [CNDP], notamment dans le cas d'hébergement ou de stockage des données sur des serveurs situés à l'extérieur du territoire national. »
- **32-2015 of 13/02/2015, customer management, model declaration, form F-214.** https://www.cndp.ma/wp-content/uploads/2023/01/deliberation-n-32-2015-13-02-2015.pdf
  - Notified « au moyen d'une déclaration type ».
  - Transfers « préalablement notifié ».
- **98-AU-2015 of 12/06/2015, supplier management, model authorisation, form F-113.** https://www.cndp.ma/wp-content/uploads/2023/01/deliberation-n-98-AU-2015-12-06-2015.pdf. The builder's agent read it; I did not open it.
- **No model covers** the visitor log, the vet and technician contacts, the register keepers or a login log. These go through a normal declaration, **F-211**.

**Forms** (CNDP, re-issued 10/09/2025)

| Form | Use | URL |
|---|---|---|
| F-211 | Normal declaration | https://www.cndp.ma/wp-content/uploads/2025/09/CNDP-Declaration-Normale_F211_20250910_Fr.pdf |
| F-214 | Declaration under a model | https://www.cndp.ma/wp-content/uploads/2025/07/CNDP-Declaration-Normale-Conformement-Decision_F214_20250724_Fr.pdf |
| F-112 | Normal authorisation | https://www.cndp.ma/wp-content/uploads/2025/09/CNDP-Autorisation-Prealable-F112-20250910.pdf |
| F-113 | Authorisation under a model | https://www.cndp.ma/wp-content/uploads/2025/09/CNDP-Autorisation-Prealable-Conformement-Decision-F113-20250910.pdf |
| F-118 | Transfer abroad | https://www.cndp.ma/wp-content/uploads/2025/09/CNDP-Transfert-Etranger-F118.pdf |

- F-211's part A says that a transfer abroad "devra faire l'objet d'une demande simultanée".
- **Attachments** (2025 procedure):
  - the information notice;
  - the consent document;
  - « Copie du contrat de sous-traitance avec clauses de confidentialité, le cas échéant »;
  - proof of signing authority;
  - for HR, an employment-contract clause.
- **Filing:**
  - Décret art. 24: registered letter, delivery against a receipt, or electronically with an acknowledgement.
  - The délibérations of 28/11/2025 name a « plateforme CNDP-FORMS ». Its URL was **not found**: confirm it with the CNDP (contact@cndp.ma).

**Who files**
- Art. 1.5 defines the responsable as whoever "détermine les finalités et les moyens"; art. 1.6 defines the sous-traitant.
- Art. 12 and 14, and décret art. 24: the responsable files.
- Art. 23: a written contract with the sous-traitant, which acts « sous la seule instruction du responsable » and shares the security duty.
- Art. 61: the sous-traitant is criminally liable for leaks (6 months–1 year, 20 000–300 000 DH).
- **Reading:**
  - Each farm (the owner, as employer and trader) is the responsable for its farm data.
  - The publisher is its sous-traitant for that data.
  - The publisher is the responsable for its own customer file and the platform's security log.

**Transfers abroad**
- **Art. 43:** transfer only to a State with « un niveau de protection suffisant »; the CNDP keeps the list.
- **Art. 44:** exceptions:
  - the person's express consent;
  - the listed necessities, including a contract with the person;
  - « autorisation expresse et motivée de la Commission nationale … notamment en raison des clauses contractuelles ».
- **Délibération 236-2015 of 18/12/2015** (amending 465-2013). Read: https://www.cndp.ma/wp-content/uploads/2023/12/deliberation-n-236-2015-18-12-2015.pdf.
  - The 32 States: Allemagne, Autriche, Belgique, Bulgarie, Canada, Chypre, Danemark, Espagne, Estonie, Finlande, France, Grèce, Hongrie, Irlande, Islande, Italie, Lettonie, Liechtenstein, Lituanie, Luxembourg, Malte, Norvège, Pays-Bas, Pologne, Portugal, République Tchèque, Roumanie, Royaume-Uni, Slovaquie, Slovénie, Suède, Suisse.
  - **The United States is not on the list.**
  - Art. 1 opens: « Sous réserve de notifier à la CNDP, suivant le régime approprié, tout transfert ». So **even an EU transfer is notified on F-118**, and the CNDP answers within 2 months.
  - No later amendment was found. That is an inference, not a confirmation.
- **Stricter recent wording:**
  - D-940-2025 §11: no transfer « sans autorisation préalable de la CNDP ».
  - CNDP–Microsoft press release, 06/04/2022: « La loi 09-08 soumet la possibilité de transfert à l'étranger à l'obtention d'une autorisation préalable ».

**Sanctions**
- Art. 52: processing without the declaration or authorisation: 10 000–100 000 DH.
- Art. 60: a transfer in breach of art. 43–44: 3 months–1 year and/or 20 000–200 000 DH.
- Art. 64: doubled for a legal person.

### Decided default

1. **Demo on Vercel + Supabase: synthetic data only.** This is ADR-007's existing rule ("development and test data are synthetic only"), applied to the demo.
   - Vercel and Supabase are US companies. The US is not an adequate country. Even an EU region needs an F-118 and the CNDP's answer, which can take up to 2 months. No real farm, worker, buyer or phone number goes in.
   - The only real personal data a demo touches is the login phone of whoever presents. Use the demo account (`DEMO_PHONE`) only, with a fixed demo code, so no real phone reaches an SMS vendor or the US-hosted logs.
   - Still pick the EU regions (Supabase eu-central-1 Frankfurt or eu-west-3 Paris; Vercel function region fra1 or cdg1). That limits exposure if real data slips in. **Check the region names on the providers' consoles; they were not read in their docs for this study.**
2. **The pilot with real data** needs, before the first real entry:
   - each farm's filings (template below);
   - the publisher's filings;
   - an art. 23 contract between each farm and the publisher;
   - the hosting decision (OQ1). Either host in Morocco, which needs no F-118, or file an F-118 per foreign recipient (hosting, SMS vendor) and wait for the CNDP's answer.
3. **Retention, to state in the filings**, from texts already in the repo:
   - books and supporting documents: 10 years (loi 9-88, art. 22; `docs/data-requests.md`);
   - the sanitary register: at least 1 year after removal for meat birds, 2 years for layers and breeders (arrêté 2126-05, art. 9);
   - biosecurity logs: 12 months (pack default, CQ5);
   - everything else: deleted 30 days after the organisation leaves.
   - **Proposed, to decide:** `AuthEvent` kept 12 months. There is no rule yet (ADR-006 / ADR-007). 12 months matches the pack.

### Draft filing (French, for the owner to adapt and sign)

**Notice for the farm's filing**: one set per farm (the farm = responsable du traitement).

> **Responsable du traitement :** [Raison sociale ou nom de l'exploitant], [forme juridique], [adresse], RC n° [ ], ICE [ ], représentée par [nom, qualité]. Contact pour les droits d'accès, de rectification et d'opposition : [nom], [téléphone], [adresse électronique].
>
> **Sous-traitant :** [Éditeur], [adresse, RC, pays], éditeur et hébergeur de l'application de gestion d'élevage, agissant sur instruction du responsable (loi 09-08, art. 23 ; contrat de sous-traitance joint). Sous-traitants ultérieurs : [hébergeur : nom, pays, région du centre de données] ; [prestataire SMS : nom, pays].
>
> **Traitement 1 : Gestion des ressources humaines** (formulaire F-113, conformément à la délibération n° 298-AU-2014 du 11/04/2014).
> - Finalités : gestion des employés de l'exploitation, présence, tâches, avances, paie, formation et accidents du travail.
> - Personnes : salariés et ouvriers saisonniers.
> - Données : nom, prénom, téléphone, salaire journalier, présences, congés, avances, n° d'immatriculation CNSS, formations suivies, accidents du travail (description, jours d'arrêt). Pas de n° de CIN.
> - Destinataires : l'exploitant et les gérants habilités ; le comptable (accès en lecture, avec l'accord de l'exploitant) ; la CNSS (déclarations) ; le sous-traitant.
> - Conservation : durée de la relation de travail ; les éléments de paie, pièces justificatives comptables, 10 ans après la fin de l'exercice (loi 9-88, art. 22) ; le reste supprimé 30 jours après la fin du service.
> - Transferts : [aucun, hébergement au Maroc] ou [hébergement à … : demande F-118 simultanée].
>
> **Traitement 2 : Gestion des clients** (formulaire F-214, conformément à la délibération n° 32-2015 du 13/02/2015).
> - Finalités : ventes de volailles et d'œufs, factures, encaissements, créances.
> - Personnes : acheteurs (chevillards, revendeurs, particuliers).
> - Données : nom, téléphone, adresse, établissement de destination des volailles, ventes, paiements.
> - Destinataires : l'exploitant, les gérants, le comptable, le sous-traitant ; les services de l'ONSSA (document d'origine des volailles, loi 49-99, art. 10).
> - Conservation : 10 ans pour les pièces comptables (loi 9-88, art. 22), téléphone effacé à la suppression du compte.
>
> **Traitement 3 : Gestion des fournisseurs** (formulaire F-113, conformément à la délibération n° 98-AU-2015 du 12/06/2015).
> - Finalités : achats d'aliment, de poussins, de produits vétérinaires, paiements.
> - Données : nom, téléphone, achats, paiements.
> - Conservation : idem traitement 2.
>
> **Traitement 4 : Suivi sanitaire et biosécurité de l'élevage** (formulaire F-211, déclaration normale).
> - Finalités : tenue du registre de suivi sanitaire (arrêté n° 2126-05), registre des visiteurs, intervenants (vétérinaire sanitaire, technicien, tenanciers du registre), membres de l'équipe ayant accès à l'application.
> - Personnes : visiteurs, vétérinaire, technicien, membres de l'équipe.
> - Données : noms, téléphones, plaque du véhicule et motif des visiteurs, dates de visite, comptes d'accès (téléphone, rôle).
> - Base : obligations des textes ONSSA (loi 49-99 ; arrêtés n° 2126-05 et 2127-05) et intérêt légitime de biosécurité.
> - Destinataires : l'exploitant, les gérants ; les inspecteurs de l'ONSSA (registre imprimé) ; le sous-traitant.
> - Conservation : registre au moins 1 an après l'enlèvement des volailles de chair, 2 ans pour les pondeuses (arrêté n° 2126-05, art. 9) ; registre des visiteurs 12 mois ; supprimé 30 jours après la fin du service.
>
> **Mesures de sécurité (section IX du F-211) :**
> - connexion par code à usage unique envoyé au téléphone, avec captcha et limitation des tentatives ;
> - rôles (propriétaire, gérant, ouvrier) : les ouvriers ne voient ni l'argent ni les salaires ;
> - cloisonnement des données par exploitation ;
> - journal d'audit des modifications ;
> - chiffrement des échanges (HTTPS) ;
> - sauvegarde quotidienne chiffrée (AES-256), restauration testée ;
> - export et suppression des données sur demande.
>
> **Information des personnes (art. 5) :** une notice remise aux employés et affichée à l'entrée pour les visiteurs (modèle joint).

**Publisher's own filings:**
- F-214 under 32-2015 for its customer file of farm owners (contract, billing, support).
- F-211 for the platform's account and security log (`User`, `Session`, `AuthEvent`: masked phone, /24 subnet, user agent), retention per the decision above.
- F-118 for each foreign recipient, if any.

**F-118 content**, if hosted abroad (fields per the form):
- I. Responsable and sender.
- II. Recipient: provider name, country, RC or other identifier; type « Sous-traitant »; whether the country has a data protection authority.
- III. File: the farm database; persons ≈ [n]; transfer method: continuous replication over TLS; purpose: hosting; frequency: continuous; first transfer date; receipt numbers of treatments 1–4.
- IV. Consent: none relied on.
- V. Recipient's processing: storage only.
- VI. For a non-listed country: « clauses contractuelles » (the provider's DPA attached, art. 44.3).
- VII. Security: encryption in transit and at rest, access control, deletion at contract end.
- VIII. Signature.

### Builder tasks

| Task | Files | Acceptance criteria | Size |
|---|---|---|---|
| **C1. Demo mode with a fixed code for the demo phone only** | `src/lib/env.ts` (production guard), auth request/verify, `.env.example`, `docs/deploy.md` or a new `docs/demo.md`; a banner component | `DEMO_MODE=1` lets **only** `DEMO_PHONE` log in with a code from the env, never sends an SMS, and shows a « Données fictives — démonstration » banner. Any other number is refused. The production guard still refuses `OTP_CONSOLE_SINK`. A test proves a non-demo phone gets no code. **Security review required** (`poultry-auth`). | S |
| **C2. Information notices and the art. 23 contract template** | `docs/cndp/` (notice employés, notice visiteurs, contrat de sous-traitance, the four filings above as fill-in documents) | French documents ready to print. Every article cited exists in the law text. Marked "à faire relire par un juriste". No code. | M |
| **C3. Retention of `AuthEvent`** | scheduler step, ADR-006/007 amendment, `docs/data-requests.md` | Rows older than 12 months are deleted by the daily scheduler. Integration test. Decision recorded as a decided default, to review. | S |
| **C4. ADR for hosting and transfers** | `docs/decisions/ADR-0xx` superseding ADR-007's hosting part | Records: demo = synthetic only on Vercel + Supabase (EU regions); pilot = Morocco hosting, or abroad after the F-118 answer; adequacy list 236-2015, with the US absent. | XS |

### Truly blocked

- The owner's signature and filing.
- The CNDP-FORMS portal URL.
- A lawyer's review of the notices and the contract.
- The hosting choice (OQ1).
- The CNDP's answer on any F-118: up to 2 months, extendable.

---

## 4. Market prices (SPEC-m5 NQ3; built as T94/T95)

### Findings

| Source | What it has | Terms |
|---|---|---|
| **FISA**, « Dawajine Conjoncture », https://fisa.ma/conjoncture/ (spot-checked: 42 PDFs listed by `https://fisa.ma/wp-json/wp/v2/media?search=conjoncture`) | Monthly 2-page PDF, issues 2023-01 to 2026-01, all uploaded in April 2026. Series: « Cours moyen poulet chair / région Casablanca (Dh/kg vif à la ferme) », a weighted turkey price (Dh/kg vif), large eggs at the Casablanca wholesale market (Dh/unité), volumes of chicks and slaughter. No chick, feed or cull-hen price. No issue after January 2026. | Footer « © 2026 Fisa Maroc. Tous droits réservés. » The site's terms page is an unfilled theme placeholder. **No reuse licence.** |
| Ministry of Agriculture, Asaar (http://app.agriculture.gov.ma:9797/asaar/) | The press reports daily prices, live chicken at the Casablanca wholesale market included | Unreachable from here (timeout or DNS). No terms page on agriculture.gov.ma. |
| HCP consumer price index; data.gov.ma `data_i4166` | An index, not prices. Eggs sit inside "Lait, fromage et œufs". | ODbL on data.gov.ma. HCP terms allow commercial reuse with credit (§3) but contradict it in §5. **Not a price.** |
| data.gov.ma search (volaille, oeufs, poulet, aviculture) | 0 datasets | ODbL |
| ANPC, ANPO, Ministry of the Interior's price commission, ONICL, Bank Al-Maghrib, mcinet | No series found. ONICL's site was down. | — |
| Conseil de la concurrence | One-off reports (avis A/3/24 on feed and chicks) | CGU forbid reproduction and collection without written authorisation |

### Decided default

- **Manual entry stays the only source** (MP1–MP3, as built). No import, no scraping.
- Optional: on `/prices`, a plain link « Cours de référence : bulletin mensuel de la FISA » to https://fisa.ma/conjoncture/. It is a link only, with no figure copied.

### Builder tasks

| Task | Files | AC | Size |
|---|---|---|---|
| P1 (optional). FISA link | `src/components/prices.tsx` (or the `/prices` screen), FR/AR strings | One external link (`rel="noopener"`) under the history, opening the FISA page. Offline, it shows but can't open (no precache). | XS |
| P2. Spec | `SPEC-m5.md` NQ3 | NQ3 gets "Decided 2026-11-24: no reusable official feed; FISA monthly bulletin under 'tous droits réservés'; ask FISA before any import", with the URLs | XS |

### Truly blocked

- FISA's written permission, before any import.
- Asaar's access and terms: someone must open it from a Moroccan connection and ask the ministry.

### 4b. T78 CNSS export (SPEC-m4 MQ3)

- The CNSS's Damancom terms of use (ref. 212-2-28), art. 3, require the « cahier des spécifications techniques relatif à la réalisation des déclarations des salaires en Mode Echange de Fichiers ». They state it « est mis à la disposition des affiliés sur le site public Internet du système DAMANCOM ». Copy of the terms: https://rabat.eregulations.org/media/conditions_gle.pdf.
- **No official download was found.** damancom.ma is a single-page app with no link to the specification. Only a private Scribd upload exists, with no version.
- **T78 stays blocked** until the specification is obtained from the CNSS or through an affiliate account. Do not build from secondary descriptions.

---

## 5. ONSSA register and inspection checklist (CQ2, CQ4)

### Findings

Compared: `docs/sources/onssa/*` (S1–S11) with `src/modules/reporting/domain/inspection.ts` (`CHECKLIST`, `CHECK_SOURCES`), the `installations` string in `messages/fr.json` (« Clôture d'au moins 1,5 m avec portail, autoluve et pédiluves, sas sanitaire, aucun autre animal d'élevage sur la ferme »), and the `src/` citations.

**Already reflected:**
- Authorisation, vet contract, register and vet visas, annexes, water, cleaning plan, rodents, carcasses, the 20-day downtime and Newcastle with lots.
- The origin document (loi 49-99, art. 10, `origin-document.tsx`).
- Manure spreading at 500 m (BS7).
- Disposal methods (CQ4).

**Not reflected:**

| Text | Obligation | Where it should go |
|---|---|---|
| Dahir 1-75-292, art. 1 and 3; arrêtés 3308-17, 2466-17 and 2836-17, art. 1 (S6, S7, S9) | Immediate declaration of a suspected listed disease: to the local authority (dahir); to the ONSSA veterinary service of the place, for Newcastle, HPAI and SPG | Info line on the checklist + V1's card |
| Arrêté 2127-05, art. 2 (S2) | « de toilettes munis d'un lavabo à l'intérieur de l'exploitation »; the sas sanitaire as two changing rooms separated by showers | `installations` self-declaration text |
| Arrêté 2127-05, art. 4 (S2) | Buildings: concrete floor, side walls ≥ 60 cm, hard gables, a ceiling as specified, a service airlock, concrete surrounds ≥ 50 cm, paved loading areas, wash-water drainage, and « ouvertures … munies de filets ou de grillage, de manière à empêcher l'accès des oiseaux et des rongeurs » | New self-declared line « Bâtiments » (art. 4) |
| Arrêté 2127-05, art. 4; décret 2-04-684, art. 12 (S2, S4) | « dès l'enlèvement des animaux, le fumier doit être humidifié dans le bâtiment d'élevage avant son évacuation et les opérations de nettoyage, de lavage et de désinfection doivent être menées aussitôt » | Self-declared, or a step of the clean-out checklist (BS) |
| Arrêté 2127-05, art. 4 (S2) | Layer farms: « un local de stockage des oeufs à l'extérieur des bâtiments d'élevage et d'une aire de stockage des fientes », droppings removed « par des camions étanches » | Self-declared line, shown only when the farm has a layer batch |
| Arrêté 2127-05, art. 4 (S2) | « le logement du personnel doit être isolé avec un accès propre de l'extérieur de la ferme » | `installations` text |
| Arrêté 2127-05, art. 2 vs décret art. 8 as amended | Well water: twice a year (arrêté) vs at least once a year (decree 2023) | Already handled (CQ2 cites both) |

Out of scope for a grower:
- hatchery chapters (2127-05, art. 3; arrêté 2125-05);
- breeder screening (2130-05, 2836-17);
- transport-vehicle specifications (décret, titre III).

### Decided default

- Extend the self-declaration. Each new line is « à vérifier sur place », ticked and signed on paper, with its article.
- Add one info line for the declaration duty.
- No new data, no new table.

### Builder tasks

| Task | Files | AC | Size |
|---|---|---|---|
| **R1. Checklist lines from 2127-05 art. 2 and 4** | `src/modules/reporting/domain/inspection.ts` (`CHECKLIST`, `CHECK_SOURCES`: new keys `buildings`, `manure`, `layerStores` shown only with a layer or pullet batch in the pack), `inspection.test.ts`, `messages/fr.json` + `ar.json`, SPEC-m2-compliance CQ2 | Each new line has state `check` and prints its source (« Arrêté n° 2127-05, art. 4 » ; manure « Arrêté n° 2127-05, art. 4 ; décret n° 2-04-684, art. 12 »). `installations` text adds the toilets with washbasin, the showers of the sas and the isolated staff housing. Test: a broiler-only farm has no `layerStores` line. | S |
| **R2. Declaration info line** | same files + V1 | An info line (like the 500-bird threshold line) cites dahir 1-75-292, art. 1 and 3, and arrêtés 3308-17, 2466-17 and 2836-17, art. 1 | XS |
| **R3. Source README** | `docs/sources/onssa/README.md` | Adds S12 (dahir 1-75-292) and "What is cited where" lines for R1 and R2 | XS |

### Truly blocked

Nothing to build. ONSSA or the vet confirming the checklist stays "to review", as before.

---

## Not verified in this study

- Decree 2-09-165, read only through the footnotes of the consolidated law. Délibération 98-AU-2015 and forms F-214, F-112 and F-113 were read by a sub-agent or not opened. I spot-checked 236-2015, 298-AU-2014 and 32-2015 myself.
- The CNDP-FORMS URL. The Asaar portal (unreachable).
- Supabase and Vercel region identifiers (not read in their docs).
- PCA page numbers p. 4 and front matter: the footers start later, so p. 4 is estimated. All other pages are read from the footer before the passage's page break.
- That no later CNDP délibération changes the adequacy list (none found).
