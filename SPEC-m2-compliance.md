# Spec: M2 compliance (`biosecurity`, `documents`, `reporting`)

_v0.1, 16 Nov 2026. Status: **draft**. The non-finance half of milestone M2 "Money & compliance" ([CAPABILITY-MAP.md](CAPABILITY-MAP.md)); the finance half is [SPEC-finance.md](SPEC-finance.md). Conventions, stack, commands, testing levels and boundaries of [SPEC.md](SPEC.md) §2–§7 apply unchanged. Plan: [tasks/plan-m2-compliance.md](tasks/plan-m2-compliance.md). Screens: canvas "DigiAtlas-VOLAILLE", frames C-Register, C-Documents, B-Visitors, B-Cleanout, B-Disposal (private claude.ai page; everything needed to build is in this file)._

## 1. Objective

Give a farm what an ONSSA inspection and the end of a batch ask for, **from what it already records**, without a second notebook:
- the **health monitoring register** (registre d'élevage) of each batch, printable as a PDF (law 49-99 art. 3, NEEDS-ANALYSIS §4);
- the **batch report** at closing: KPIs, health, sales, margin, comparison with past batches and the strain standard (SCOPE §13);
- **biosecurity** logs kept on the phone, offline: visitors and vehicles, clean-out and downtime (vide sanitaire), dead-bird disposal (art. 12), manure (art. 13), rodent control with physical proof (art. 15);
- a **document vault** with expiry alerts and a one-click **inspection pack** (SCOPE §17).

**Users:** workers log visitors, dead-bird disposal, manure and clean-out steps on the phone; managers and owners also keep documents and print the register, report and pack. Workers never see money (SPEC I5).

**Never invented here** (§9): the official register's columns and layout, legal mentions, authorized disposal methods, the minimum downtime, retention periods, the inspection checklist. Since 2026-11-23 they follow the official ONSSA texts in [docs/sources/onssa/](docs/sources/onssa/README.md) (S1–S7), each rule citing its article; experts review later (§9). What the app doesn't record is printed as a blank line to fill by hand, never invented.

**Out of scope:** the vet account and e-signature (`partner-access`, M5); lab results as structured data (they enter as documents); manure **sale** money (needs a finance posting rule, follow-up); merging uploaded PDFs into the pack (needs a PDF library, CQ6); notifiable-disease workflow; water analyses as data; insect control.

## 2. Modules

| Module id | Level (poultry-ddd §1) | Owns | Depends on (CAPABILITY-MAP, unchanged) |
|---|---|---|---|
| `biosecurity` | Light | `Visit`, `Cleanout` + `CleanoutStep`, `Disposal`, `ManureRemoval`, `RodentCheck` | `farm-registry`, `flock`, `notifications` |
| `documents` | Light | `Document`, `StoredFile` | `farm-registry`, `notifications` |
| `reporting` | Light (pure `domain/` for the register and report builders) | no table | `flock`, `health`, `biosecurity`, `documents`, `sales`, `finance` |

A biosecurity record points to a proof file **by id** (`proofFileId`), the app layer wires the upload: `biosecurity` does not import `documents`, so the capability map stays as approved.

## 3. Decisions (safe defaults, to report)

| # | Decision | Why |
|---|---|---|
| D1 | **PDF = print CSS** (the browser's "Enregistrer en PDF"), no PDF library, like the origin document (T23) | No new dependency; Arabic shaping and RTL come free from the browser; works offline |
| D2 | **The register is built on the phone** from its local records (static shell, precached), like `/origin` | An inspection happens on the farm, often without network. All the data is already synced |
| D3 | **Files live in PostgreSQL** (`StoredFile.bytes`, `bytea`), uploaded online through one route handler; ADR-011 | No external service (SPEC §7 "ask first"); the database is the approved data location (ADR-007). Revisit with hosting (OQ1) |
| D4 | Files: PDF, JPEG, PNG, WebP only, checked by magic bytes, **≤ 5 MB**, served as attachment with `nosniff`, tenant-scoped | Upload is a trust boundary |
| D5 | Biosecurity records are **offline mutations**; a proof photo is attached **when online** from the same record ("preuve à ajouter" until then) | Sync protocol unchanged (SPEC §7 "ask first") |
| D6 | Records are never deleted; a correction is an edit, audited | Inspection evidence. Not a legal retention rule (CQ5) |
| D7 | The batch report is **online, owner and manager**, and takes the margin from `finance` (FN13), not M1's locked cost | One margin in the app |
| D8 | Visitor rule: "visited another farm recently → dirty zone only"; the hours are **configuration** (`VISITOR_RECENT_FARM_HOURS`, 48 from the mockup), marked as a farm rule, not law | No hardcoded threshold (poultry-ddd §3.7) |
| D9 | Minimum downtime and disposal methods are **not** defaulted: the owner sets the farm's own minimum (optional); disposal methods are those NEEDS-ANALYSIS / SCOPE name (incineration, authorized site) + "other, describe" | CQ3, CQ4 |

## 4. Requirements: `biosecurity`

- **BS1. Visitor log.** A visit records farm, date and time of entry, name and company, vehicle plate (optional), purpose (feed delivery, gas, chick delivery, vet, buyer or catching crew, technician, other), "visited another poultry farm within `VISITOR_RECENT_FARM_HOURS`", and the entry checks: vehicle wheels disinfected, footbath and overshoes, farm clothing provided. Any member can record it, offline.
- **BS2. Zone.** A visitor who answered yes to the recent-farm question is allowed in the **dirty zone** only; the screen says so before saving and the record keeps `zone`. Others choose clean or dirty. The rule is a pure function shared by the phone and the server.
- **BS3. Today's visits.** The visitor screen lists today's visits of the farm (time, name, zone).
- **BS4. Clean-out.** After a batch closes, a house has a clean-out record (house, batch it follows) with the SCOPE §4 steps in order: manure removed, equipment dismantled and washed, high-pressure wash, disinfection (product, dose, product lot), rodent control with proof, water check and line flushing, litter and pre-heat. Each step is marked done with its farm day (and the step's fields); steps may be marked out of order but each once. Offline.
- **BS5. Downtime (vide sanitaire).** Downtime starts on the disinfection day. The screen shows "day N" since then, and the farm's minimum when the owner set one (`Farm.minDowntimeDays`, optional). Placing a batch in the house while the minimum isn't reached gives a **warning**, never a block (CQ3).
- **BS6. Dead-bird disposal.** A disposal records farm, farm day, batch (optional), birds, weight in grams (optional), method (`incineration`, `authorizedSite`, `other` + description). The screen shows each batch's mortality from the daily entries next to the birds disposed for the same days, so a gap is visible. Offline.
- **BS7. Manure.** A removal records farm, farm day, house and batch (optional), quantity in kg (integer), destination (`stored`, `spread`, `sold`, `given`), recipient (optional text). No money (out of scope §1). Offline.
- **BS8. Rodent control.** A check records farm, house (optional), farm day, action (`baitPlaced`, `baitChecked`), product (optional), and a proof photo (`proofFileId`, added online). Without a photo the record shows "preuve à ajouter".
- **BS9. Permissions.** `biosecurity.record`: owner, manager, worker (the worker's job, like daily entries). Setting a farm's minimum downtime: `farms.manage`.

## 5. Requirements: `documents`

- **DC1. Vault.** A document has a title, category (`authorization`, `vetContract`, `labReport`, `insurance`, `land`, `company`, `tax`, `equipment`, `other`), farm (optional: the organisation as a whole), issue date and expiry date (both optional), notes, and zero or one file. Owner and manager create and edit them; workers neither see nor receive them (leases, tax papers).
- **DC2. Files.** Upload through `POST /api/files` (multipart, D3, D4), owner and manager, CSRF-protected like every route handler (poultry-auth). Download through `GET /api/files/<id>` for the same roles, or for any member when the file is a biosecurity proof. A file has an owner organisation, a content type, a size, a SHA-256 and the uploader.
- **DC3. States.** By expiry: `expired` (before today), `soon` (within `DOCUMENT_SOON_DAYS`, config, 60 from the mockup), `valid`, `none` (no expiry). The list is sorted by expiry, soonest first.
- **DC4. Expiry alerts.** The dispatch job (`POST /api/push/dispatch`) notifies owners and managers once at `DOCUMENT_SOON_DAYS` before expiry, once on the day, through `notifications` (`documentExpiring`, `documentExpired` templates, AR + FR). The farm's ONSSA authorization (SPEC F2) gets the same alerts even without a vault document.

## 6. Requirements: `reporting`

- **RP1. Register contents.** For one batch, the register holds what NEEDS-ANALYSIS §4 lists (law 49-99 art. 3 + arrêté of 15/12/2005): **cover**: farm name and address, ONSSA authorization number and expiry, house, species and strain, hatchery and chick delivery note, placement date and chicks placed, dead on arrival; **content**: daily mortality with cause and culls, birds on hand, feed (kg) and water (L) per day; vaccinations (age, product, product lot, method, who); treatments and vet prescriptions (product, dose, dates, prescriber, reason, withdrawal end); vet visits; birds out (sales: date, birds, farm weight, buyer when visible, origin-document number); dead-bird disposals (BS6). Lab reports: documents of category `labReport` for the farm during the batch (titles and dates). Built by one pure function `buildRegister`.
  Since 2026-11-23 the contents and order follow arrêté n° 2126-05 (S1, CQ1 below).
- **RP2. Register PDF.** `/register#<batch id>` is a static shell (precached, offline) that prints the register in the page's language (AR or FR), A4, paginated "n / N", with the détenteur's visa and the vet visa grid (CQ7). Any member can print it; money never appears in it.
- **RP3. Batch report.** `/report?batch=<id>`, online, owner and manager, printable: final or live KPIs (age, mortality %, FCR, EPEF, average weight vs the strain standard, ADG), birds placed / sold / dead, health summary (vaccinations done vs planned, treatments, withdrawal), sales (birds, kg, average price), the **finance result** (FN13: sales, costs, margin, margin and cost per kg), and the comparison with the farm's previous closed batches (mortality, FCR, cost/kg, margin/kg). Built by a pure function `buildBatchReport`.
- **RP4. Inspection pack.** `/inspection`, owner and manager, prints for one farm in one document: the authorization (F2), the vault's documents with their state, the registers of the open batches and those closed within their retention period (`INSPECTION_LOOKBACK_MONTHS`: 12 months for meat batches, 24 for layers and pullets, CQ5), clean-outs, visitor log, disposals, manure and rodent checks of the last 12 months. The checklist's lines come from the texts, each printed with its source (CQ2); items missing are listed as missing (e.g. no rodent proof photo). Uploaded files are listed with their download link, not merged (CQ6).

## 7. Cross-cutting

- **CX1.** Every biosecurity screen works offline and survives a reload (SPEC X1); e2e proves it for the visitor log.
- **CX2.** Tenant isolation is integration-tested for every new mutation, entity, page and route handler (SPEC X3).
- **CX3.** All strings exist in `fr.json` and `ar.json`. Printed documents follow the page's language.
- **CX4.** Every state change writes an audit event in the same transaction (ADR-006).
- **CX5.** New screens are structurally simple (Tailwind, semantic HTML) and take the design-system components once `feat/u1-design-system` lands.

## 8. Calculations and fixtures

Pure functions, unit-tested first, with the canvas demo farm.

| Function | Rule | Fixture → expected |
|---|---|---|
| `visitZone` | recent farm → dirty only | recent: yes → `dirty`, clean refused; no → the chosen zone |
| `downtimeDay` | today − disinfection day + 1 (day 1 is the disinfection day) | disinfected 5 Nov, today 6 Nov → day 2; minimum 14 → ends 19 Nov (canvas "jour 2 sur 14 · fin le 19 nov.") |
| `downtimeWarning` | minimum set and placement day − disinfection day < minimum | min 14, disinfected 5 Nov, placement 17 Nov → warn (12); 24 Nov → no warning (19) |
| `documentState` | expired / soon / valid / none | expiry 30 Nov 2026, today 5 Nov, soon = 60 → `soon`; 15 Mar 2027 → `valid`; 1 Nov → `expired` |
| `buildRegister` daily rows | birds on hand = placed − DOA − cumulative dead and culls − sold, per day | B-2026-13: 10 000 placed, 26 Oct (J36) 4 dead → 9 620 → canvas row "9 620 · 4" |
| `buildRegister` withdrawal | treatment end + withdrawal days (health rule) | enrofloxacine 22–26 Oct, 5 days → 31 Oct |
| `disposalGap` | daily mortality − birds disposed, per day | 6 dead, 6 disposed → 0 |
| `buildBatchReport` comparison | per closed batch, newest first | margin/kg 1,87 for B-2026-13 (SPEC-finance §7) |

## 9. Open questions (for the owner, ONSSA, a private vet)

| # | Question / decided default | Blocks |
|---|---|---|
| CQ1 | **Decided default (2026-11-23), to review.** S1 (arrêté n° 2126-05) annexes no form: it lists contents. The batch register is the paper « registre de suivi sanitaire » (art. 8: paper, paginated, data in chronological order by type), legal line « Arrêté n° 2126-05 du 15 décembre 2005 (décret n° 2-04-684, art. 8) », sections in art. 2's order: cover (art. 3: authorization number, farm name and address, hatchery and delivery note, détenteur, register keepers, vet sanitaire, houses, species, production type and strain, placement date and birds placed); supervision sheet (art. 2: vet sanitaire, vault vet contract, technician); chronological daily rows (art. 4: daily and cumulative mortality, feed per feed type, daily eggs for layers, observations, lab reports, vet visits, treatments, vaccinations, lots leaving); medicines with commercial name, dose, start and end, prescription (art. 4); vaccinations with vaccine, commercial name, lot, date, number of birds, species, age (S6 art. 14, S7 art. 13); lots leaving (art. 4); vet visas (art. 7); « pièces à joindre » (art. 2, 5). Fields the app doesn't hold (détenteur, keepers, vet sanitaire's name and address, technician) print as blank lines. Not held and not printed yet: agrément number (chick importers only), a treatment's route of administration, the destination establishment's name and address | RP1–RP2: done; field follow-ups in the plan (T47) |
| CQ2 | **Decided default (2026-11-23), to review.** ONSSA publishes no inspection grid: the checklist is built from the texts, each line printed with its source: authorization (S3 art. 1–2); vet supervision contract (S5 art. 1; S3 art. 7); register with a monthly vet visa (S1 art. 7, 8, 16; a month of a batch's life without a recorded visit is missing, an open batch's current month excepted); delivery notes, lab bulletins, prescriptions (S1 art. 2, 5); well water analysed at least once a year or a public network certificate (S4 art. 8 as amended by décret n° 2-23-111; S2 art. 2 said twice a year); cleaning and disinfection plan (S2 art. 2); rodent and insect control with material proof (S2 art. 2; S3 art. 15); carcass destruction system (S2 art. 2; S3 art. 12; methods: CQ4); downtime ≥ 20 days between batches (S2 art. 4; computed per house from closing to the next placement, a shorter one is missing; the start day and the per-farm rule are CQ3); Newcastle vaccinations recorded with lot numbers (S6 art. 13–14); fixed installations as a self-declaration (fence ≥ 1.5 m with gate, wheel dip and footbaths, changing room, no other livestock; S2 art. 2, 4). Each line is « conforme d'après les saisies », « à compléter » or « à vérifier sur place » (self-declaration, ticked and signed on paper). Info line: S3 art. 1, batches of 500 birds or fewer need no authorization | RP4: done |
| CQ3 | The minimum downtime between batches (vide sanitaire), per species | BS5 default |
| CQ4 | Authorized dead-bird disposal methods and distances (art. 12; is a closed pit with quicklime accepted?) | BS6 method list |
| CQ5 | **Decided default (2026-11-23), to review.** S1 art. 9: the register is kept on the farm at least 1 year from the birds' removal for meat poultry, 2 years for breeders and laying hens. `INSPECTION_LOOKBACK_MONTHS` = 12 (meat) / 24 (layers; pullets too, as future layers, a safe default; quail are counted as meat until an egg-quail type exists). The biosecurity logs have no retention text: the pack shows 12 months. Records are never deleted (D6) | Retention: done for the pack |
| CQ6 | **Decided default (2026-11-23).** No PDF merging (no new dependency): the register and the pack list the annexes « à joindre », and vault scans by their download link | RP4: done |
| CQ7 | **Decided default (2026-11-23), to review.** S1 art. 7 and 16: the vet sanitaire visas the register at least once a month and at each visit (date, observations, diagnosis, analyses, treatments with houses and withdrawal times, references of prescriptions and reports); the détenteur visas it regularly. The register prints « Visa du détenteur » and a vet visa grid (date, vet, observations and diagnosis, references, signature): one row per recorded vet visit and one blank row per month of the batch's life. Stamp and registration number: not in the texts | RP2: done |

## 10. Success criteria (compliance half of M2)

1. A demo batch prints a register in FR and AR, offline, with every RP1 section filled from the M1 data, in the order of arrêté n° 2126-05.
2. A worker logs a visitor, a disposal and a clean-out step offline; they reach the server once after sync.
3. A document due in 60 days notifies the owner once; a worker never receives documents.
4. The batch report's margin equals `/results` for the same batch.
5. `pnpm lint`, `pnpm typecheck`, `pnpm test` and each task's e2e spec pass.
