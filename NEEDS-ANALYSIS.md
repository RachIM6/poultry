# Needs analysis: farm management for Moroccan poultry farms

_Draft v0.1, 26 Oct 2026. It is built from desk research. Every legal or tax figure is tagged ⚠️ until a Moroccan accountant or lawyer has validated it. Companion file: [BENCHMARK.md](BENCHMARK.md)._

**Assumptions**
- Poultry comes first: broiler, layer, turkey, breeders, hatchery, and traditional "beldi" birds.
- "Troupeau" = **bande / lot** (one placement of birds, followed until it is sold or reformed).
- The legal, accounting and tax layer is the same for any Moroccan farm, so it can be reused later for other livestock.

---

## 1. The market in numbers

| Indicator | Value | Source |
|---|---|---|
| Poultry meat production 2025 | ~654k–800k t (sources disagree) | Médias24 2026 |
| Eggs 2025 | ~7 billion | Médias24 2026 |
| Broiler chicks | ~10.4M per week in 2025 (+11%) | FISA via Hespress |
| Turkey poults / laying pullets placed 2024 | 14.3M / 11.9M | FISA |
| Authorized farms (2023) | 900 turkey, 252 layer. Broiler figure not published | Le Matin 2023 |
| Sector revenue / jobs | 36.9 bn DH. 142k direct + 328k indirect jobs | Le Matin 2023 |
| Price crisis | Live broiler 7–9 DH/kg vs ~15 DH/kg cost. Chick price fell to ~0.5 DH | Médias24, Le360, Infomédiaire |
| The informal sector | Still a major challenge for the industry | Médias24 Apr 2026 |
| Tech adoption | 50% of broiler farms access data from sensors or controllers. Internet coverage is the #1 barrier | IAV Hassan II 2022 |

---

## 2. User segments

| Segment | Typical size | Legal form | Main pain points (hypotheses to validate) |
|---|---|---|---|
| **S1 Traditional / beldi** | <500 birds, family | Individual, informal | No records, disease, no vet. Below the authorization threshold of law 49-99 |
| **S2 Small–medium broiler farm** | 1 to 4 houses, 5k–40k birds/batch | Individual or family **indivision** | Selling below cost, feed bought on credit, no cost per kg, paper ONSSA register |
| **S3 Layer farm** | 10k–200k+ hens | SARL / individual | Laying-rate tracking, egg grading and sales, long cycles, price volatility |
| **S4 Turkey farm** | 5k–30k | Individual / SARL | Long cycle (~16–20 weeks), higher capital at risk |
| **S5 Breeders + hatchery** | Industrial | SA / SARL | Hatch rate, health certificates (law 49-99 art. 4), traceability to clients |
| **S6 Cooperative** | 7+ members (law 112-12) | Cooperative | Member accounting, special chart of accounts, general assembly, distribution of surplus (ristournes), ODCO compliance |
| **S7 Integrator / aggregator** | Feed mill, hatchery, abattoir + N farms | SA/SARL + contracts (law 04-12) | Visibility over contracted farms, inputs advanced to farmers, settlement at sale, traceability |
| **Influencers** | Private vet (mandatory, law 49-99 art. 7), accountant, Crédit Agricole, FISA delegate | — | Signing prescriptions and the register, preparing accounts and tax filings, loan files |

---

## 3. Legal forms → accounting → tax

This is the part you asked about. The product must **not** hard-code one chart of accounts. It needs **one operational core** (batches, stock, sales) and an **accounting profile** chosen per farm.

| Legal form | Legal basis | Accounting framework | Tax (⚠️ validate) | What the product must handle |
|---|---|---|---|---|
| **Individual farmer** (personne physique) | — | No CGNC obligation under the flat-rate regime. Cash book in practice | **IR on agricultural income**. **Exempt if agricultural revenue < 5M DH** (CGI art. 47-I). Above that: **flat-rate profit** (set each year by a local commission, CGI art. 49–50) or **actual net income (RNR)**. RNR is mandatory above ~2M DH according to older sources, which conflicts with the 5M exemption | Simple **cash book** (receipts and expenses per batch). **Revenue tracker against the 5M DH threshold** and the "3 consecutive years" rule. Export for the accountant |
| **Indivision** (co-owned family farm) | Civil law | Same as individual | IR. Co-owners are treated like individuals for the RNR threshold (old CGI art. 48) | **Several owners with shares (%)**, split of results |
| **SARL / SARLAU / SA / SNC** | Laws 5-96 and 17-95 | **CGNC / PCGE** (law 9-88). **Simplified model if revenue ≤ 10M DH** (balance sheet, income statement CPC, notes ETIC, simplified funding table). Normal model above that | **IS 20%** (35% if profit ≥ 100M DH). **Agricultural income exempt if revenue < 5M DH**, as long as the threshold is not exceeded 3 years in a row (CGI art. 6-I-A-29°). Minimum contribution applies once taxable | Double entry, **PCGE chart of accounts** (classes 1–8), journals, financial statements, VAT. Or at least a **clean export to the accountant's software** |
| **Cooperative** | **Law 112-12**. ODCO approves statutes | **Plan comptable des coopératives**, adopted by the CNC on 17/01/2001, arrêté n° 441-01 of 26/02/2001. Required by law 112-12 | **IS exempt** under conditions (CGI art. 6-I-A). Taxable above a **revenue threshold of ~10M DH** (⚠️ to confirm). **VAT exempt without deduction rights**, extended to agricultural services since LF 2024 (CGI art. 93-II). Statutory auditor not required if revenue ≤ 10M DH (an accountant is enough) | **Member register**, share capital, member transactions vs non-members, **ristournes**, legal reserves, **general assembly** documents, cooperative chart of accounts |
| **GIE** (economic interest grouping) | Law 13-97 | CGNC | Common tax regime | Pooled resources: shared vet, shared purchases, shared transport |
| **Association** (rural / women's projects) | Dahir 1958 | **Plan comptable des associations** (CNC opinion n° 23, 25/04/2023) | Mostly not taxed | Grants, donor reporting |
| **Aggregation contract** (on top of any form) | **Law 04-12**. Projects approved by the ADA. New arrêtés in BO 6990 (2021) | Each party keeps its own accounts | Access to subsidies and financing | **Aggregator ↔ aggregated-farmer contract**, inputs advanced, settlement, traceability |

**Takeaways**
- Most target farms (S1–S4) are individuals or indivisions **below 5M DH and exempt from tax**. For them, "finance" means **real cost per kg, margin per batch, debts and credit**, not tax accounting. Formal accounting matters for S3, S5 and S7 (companies) and for S6 (cooperatives, required by law).
- **MVP:** "cash book + management accounting per batch" for everyone, plus a **CSV/Excel export mapped to PCGE and to the cooperative chart of accounts** for the accountant. Full double-entry accounting comes later.

---

## 4. Sanitary and regulatory obligations: law 49-99 (primary text read)

The law covers poultry farming **above 500 birds per batch**, plus hatching, transport, distribution, egg centres, abattoirs and sale. The implementing decree is 2-04-684 (2004), amended by decree 2-23-111 (2023, simplification).

| Obligation | Article | What the software can do |
|---|---|---|
| **Authorization** from the veterinary services. Inspection visit within 10 days, decision within 15 days | Art. 1–3 | Store the authorization number and expiry. Checklist and file for the application |
| **Mandatory registers** kept under the owner's responsibility | Art. 3 + arrêté of 15/12/2005 (⚠️ number to confirm) | **Generate the health monitoring register automatically.** Cover page: authorization n°, hatchery the chicks came from, farm name and address. Content: **chick delivery notes, lab reports, vet prescriptions, medicines, vaccinations, feed, mortality, birds in and out** |
| **Designate a private vet** for prophylaxis | Art. 7 | **Vet account**: e-prescriptions, sign-off on visits, vaccination records |
| **Prophylaxis plan** (sanitary + medical) | Art. 3 | Vaccine program per species and strain. Newcastle vaccinations must be written in the register (ONSSA arrêté 3308-17) |
| **Ban on unauthorized additives and medicines. Withdrawal periods** | Art. 9, 11 | Product catalogue with **withdrawal period**. **Block or alert on a sale planned before the withdrawal date** |
| **Origin document** for birds going to an industrial abattoir | Art. 10 | Generate the **origin / delivery note** per sale |
| Carcass disposal by incineration or authorized means | Art. 12 | Log of how mortality was disposed of |
| Manure storage and spreading | Art. 13 | Log of manure removal |
| **Rodent control with physical proof** | Art. 15 | Hygiene and pest-control log with photos |
| Transport disinfection, washable crates | Art. 14 | Checklist for hauliers |
| Breeders and hatcheries: specific health control → official certificates. **Compensation for sanitary culling only if certified** | Art. 4–8 | Folder for certificates and analyses |
| Fines of 5,000 to 10,000 DH | Art. 18–20 | — |

---

## 5. Labour, social charges and financing

- **Farm workers:** paid at the farm minimum wage (**SMAG**), which was revalued in 2026 (⚠️ sources give 2,333 or 2,800 DH/month). They are declared to **CNSS + AMO**: about 705 DH/month per worker in total contributions according to Le360. Needs: attendance, pay, CNSS declaration, tasks per house.
- **Farmers themselves:** AMO health insurance for non-salaried workers (law 98-15).
- **Financing:**
  - Crédit Agricole du Maroc pays out state aid from the **FDA** (Agricultural Development Fund) and has a dedicated poultry support framework.
  - Sector **contract-programme 2023–2030** of ~2bn DH.
  - Abattoir subsidy of 30%.

  Needs: loan schedule, subsidy files, a **bank-ready report per batch or year**.
- **Supplier credit:** feed and chicks are often advanced by the supplier (⚠️ hypothesis to validate). Needs: supplier debt and repayment at sale.

---

## 6. Functional needs map

> Superseded by the full process catalogue in [SCOPE.md](SCOPE.md). This section is kept as a summary.

Priority uses MoSCoW: **M**ust have, **S**hould have, **C**ould have.

### A. Troupeau / batch management
- **M** Multi-farm → multi-house → batch structure. Species and strain (Ross, Cobb, Hubbard, Lohmann, ISA, BUT…) with **reference curves**.
- **M** Placement: number of chicks, hatchery, delivery note, price.
- **M** Daily entry in under 1 minute: mortality + cause, feed (kg, phase), water, eggs.
- **M** Weighings → growth curve compared with the standard. Average daily gain.
- **M** KPIs: mortality %, **FCR**, **EPEF/IEP**, cost per kg live weight, laying rate, eggs per hen housed.
- **S** Cleaning and downtime between batches (**vide sanitaire**) with a checklist. Litter management.
- **S** Barn conditions: temperature and humidity, entered by hand or from controllers (Rotem/Munters/Fancom).
- **C** Weight by camera (computer vision), sensor kits.

### B. Health
- **M** Vaccine program per species and strain. Treatments with batch, dose and **withdrawal period**.
- **M** **Health monitoring register** generated in ONSSA format.
- **S** Vet account (prescriptions, visits, e-signature). Lab results.
- **S** Mortality alerts (above x% per day), notified by WhatsApp.
- **C** Disease photo + AI hint (warn that it is not a diagnosis).

### C. Stock and purchases
- **M** Feed by phase, chicks, medicines and vaccines (**lot + expiry**), litter, gas and energy.
- **M** Automatic deduction when daily entries are saved. Low-stock alerts.
- **S** Purchase orders, supplier debts, **feed on credit**.

### D. Sales
- **M** Sales of live birds and eggs: buyer, weight, price per kg, **weighing gap**, payment and receivables.
- **M** **Origin / delivery note** document.
- **S** Regional price index (crowdsourced + FISA). Notify buyers when a batch is ready.

### E. Finance and accounting
- **M** Cash book. Margin and cost per kg per batch and per year.
- **M** **Accounting profile** per entity: individual, indivision (shares %), company (PCGE), cooperative (cooperative chart of accounts), association.
- **M** Export for the accountant (FEC-like CSV, mapped to the chart of accounts).
- **S** **5M DH revenue tracker** + 3-year history. Simple VAT handling.
- **S** Loans, subsidies, depreciation of buildings and equipment.
- **C** Full double-entry general ledger and financial statements (simplified CGNC model).

### F. People
- **S** Roles: owner, manager, worker, vet, accountant, integrator (read access).
- **S** Tasks per house, attendance, SMAG pay, CNSS export.

### G. Cooperative module
- **S** Members, shares, contributions, member vs non-member operations, ristournes, general assembly minutes and documents.

### H. Integrator / aggregator module
- **C** Portfolio of contracted farms, inputs advanced, settlement at sale, law 04-12 contracts, consolidated traceability.

### I. Cross-cutting (non-functional)
- **M** **Arabic + French**, icons for users who read little. _(Darija / voice entry: deferred.)_
- **M** **Offline-first** mobile with sync (internet is the #1 barrier).
- **M** WhatsApp notifications. Light data usage.
- **M** Data belongs to the farmer, export at any time. **Law 09-08** (CNDP, Moroccan data protection).
- **S** PDF reports: ONSSA register, bank report, cooperative general assembly report.

---

## 7. Hypotheses to validate in interviews

1. S2 farms will pay for **cost per kg + margin** more than for compliance. (Poultry.ma bets on compliance.)
2. **Feed supplier credit** is the norm, and tracking it is valuable.
3. Vets would use a shared register if it saves them visits or paperwork.
4. Cooperatives struggle with the cooperative chart of accounts and general assembly documents (ODCO compliance: only ~1/3 complied after law 112-12).
5. Farmers would contribute their sale price daily in exchange for seeing the regional index.
6. Data entry is done by a **worker**, not the owner. A simple mobile UI in Arabic matters more than a web dashboard. (Voice / Darija: keep note of demand for later.)
7. Integrators would pay per farm (B2B2C) and push the app to their contracted farmers.

## 8. Experts to consult (to remove the ⚠️ tags)

- **Moroccan accountant (expert-comptable):** the forfait vs RNR vs 5M exemption interplay, the cooperative IS threshold, VAT on feed, chicks and eggs, the simplified CGNC model.
- **ODCO:** the current cooperative chart of accounts (is the 2001 version still valid?), reporting duties under law 112-12.
- **ONSSA / private vet:** the exact register format (arrêté 2005), the downtime between batches (vide sanitaire), recent changes from decree 2-23-111.
- **FISA regional delegate:** price data, feed credit practices, and willingness to partner.
- **Crédit Agricole / ADA:** what a bank-ready file needs, aggregation projects in poultry.

## 9. Interview guide (short)

| Theme | Questions |
|---|---|
| Profile | Species, number of houses, birds per batch, batches per year, legal form, number of workers |
| Today | How do you record mortality, feed and sales? (paper, Excel, WhatsApp) Who records it? |
| Money | Do you know your cost per kg? Who supplies feed, and on credit? Who buys, and how do you agree on the price? |
| Health | Who is your vet? How do you keep the ONSSA register? Last inspection? |
| Accounting | Do you have an accountant? Which regime? What do they ask you for? |
| Tech | Phone type, internet at the farm, WhatsApp usage, would you use voice entry? |
| Willingness to pay | What would you pay per month or per batch? Who should pay: you, the integrator, the feed supplier? |

---

## Sources

**Law and regulation**
- Law 49-99 (full text): https://www.onssa.gov.ma/wp-content/uploads/2021/11/LOI.49-99.FR.pdf · https://faolex.fao.org/docs/pdf/mor125297.pdf
- Decree 2-04-684 consolidated (2023): https://adala.justice.gov.ma/api/uploads/2024/10/17/D%C3%A9cret%20pris%20pour%20l'application%20de%20la%20loi%20n%C2%B0%2049-99%20relative%20%C3%A0%20la%20protection%20sanitaire%20des%20%C3%A9levages%20avicoles,%20au%20contr%C3%B4le%20de%20la%20production%20et%20la%20c-1729156588806.pdf
- Register contents: https://www.avicultureaumaroc.com/dec3.html · ONSSA Newcastle arrêté: https://www.onssa.gov.ma/wp-content/uploads/2021/11/ARR.3308-17.FR.pdf
- Law 112-12 (cooperatives): https://ocdc.coop/wp-content/uploads/2023/07/Loi-consolidee-Cooperatives-Maroc.pdf · https://hazbane.asso-web.com/uploaded/pra-sentation-coopa-ratives.pdf · https://www.agrimaroc.ma/cooperatives-nouvelle-loi-2/
- CNC sector plans: https://www.finances.gov.ma/fr/Nos-metiers/Pages/cnc-normes.aspx · Associations chart of accounts: https://www.finances.gov.ma/Publication/depp/2023/Plan_Comptable_des_associations_et_d_autres_organismes_a_but_non_lucratif.pdf
- Law 04-12 (aggregation): https://faolex.fao.org/docs/pdf/mor199038.pdf · https://fr.hespress.com/210115-agregation-agricole-un-nouveau-dispositif-reglementaire-pour-des-projets-dagregation-de-nouvelle-generation.html

**Accounting and tax**
- CGNC models: https://upsilon-consulting.com/etats-synthese-maroc/
- Tax 2026: https://medias24.com/2026/07/13/agriculture-la-dgi-devoile-les-exonerations-fiscales-applicables-en-2026-1721463/ · https://www.tax.gov.ma/wps/wcm/connect/e48c5c9d-ae80-4b30-a1b3-80af7ec09be1/NC+737+LF+2026.pdf · https://upsilon-consulting.com/regime-fiscal-des-cooperatives/
- Flat-rate vs RNR: https://www.fiscamaroc.com/limpot-sur-revenu-29/regimes-dimposition-71.htm · https://ecoactu.ma/?p=18073

**Labour and social charges**
- https://fr.le360.ma/economie/le-smag-revalorise-les-employeurs-agricoles-sommes-de-se-mettre-en-conformite_T6JMLJ3FINEUZC4WMOTZ2PPTP4/ · https://wafir.ma/fr/actu/smig-maroc-hausse-2026-3500-mad-impact-employeurs-cnss-ir

**Market data**
- https://medias24.com/2026/04/24/volailles-forte-autosuffisance-et-dynamique-export-linformel-reste-un-defi-de-la-filiere-1665071/ · https://fr.hespress.com/404617-la-fisa-dresse-un-bilan-du-secteur-avicole-avant-ramadan.html · https://lematin.ma/express/2023/aviculture-souverainete-alimentaire-coeur-24e-salon-dawajin/390902.html · https://agrimaroc.org/index.php/Actes_IAVH2/article/download/1106/1564

**Financing**
- https://faolex.fao.org/docs/pdf/Mor181829.pdf · https://aujourdhui.ma/?p=436253
