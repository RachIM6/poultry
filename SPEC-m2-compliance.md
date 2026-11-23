# Spec: M2 compliance (`biosecurity`, `documents`, `reporting`)

_v0.1, 16 Nov 2026. Status: **draft**. The non-finance half of milestone M2 "Money & compliance" ([CAPABILITY-MAP.md](CAPABILITY-MAP.md)); the finance half is [SPEC-finance.md](SPEC-finance.md). Conventions, stack, commands, testing levels and boundaries of [SPEC.md](SPEC.md) §2–§7 apply unchanged. Plan: [tasks/plan-m2-compliance.md](tasks/plan-m2-compliance.md). Screens: canvas "DigiAtlas-VOLAILLE", frames C-Register, C-Documents, B-Visitors, B-Cleanout, B-Disposal (private claude.ai page; everything needed to build is in this file)._

## 1. Objective

Give a farm what an ONSSA inspection and the end of a batch ask for, **from what it already records**, without a second notebook:
- the **health monitoring register** (registre d'élevage) of each batch, printable as a PDF (law 49-99 art. 3, NEEDS-ANALYSIS §4);
- the **batch report** at closing: KPIs, health, sales, margin, comparison with past batches and the strain standard (SCOPE §13);
- **biosecurity** logs kept on the phone, offline: visitors and vehicles, clean-out and downtime (vide sanitaire), dead-bird disposal (art. 12), manure (art. 13), rodent control with physical proof (art. 15);
- a **document vault** with expiry alerts and a one-click **inspection pack** (SCOPE §17).

**Users:** workers log visitors, dead-bird disposal, manure and clean-out steps on the phone; managers and owners also keep documents and print the register, report and pack. Workers never see money (SPEC I5).

**Never invented here** (§9): the official register's columns and layout, legal mentions, retention periods, the inspection checklist. The minimum downtime and the disposal methods come from the official texts (CQ3, CQ4, decided defaults of 23 Nov 2026, to review). Until the other official texts arrive, every printed document carries the mention « Présentation provisoire, à valider avec l'ONSSA » and builds only on contents the repo docs name.

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
| D9 | Minimum downtime: superseded on 23 Nov 2026 by CQ3 (§9), the official 20 days. Disposal methods are those NEEDS-ANALYSIS / SCOPE name (incineration, authorized site) + "other, describe" | CQ3, CQ4 |

## 4. Requirements: `biosecurity`

- **BS1. Visitor log.** A visit records farm, date and time of entry, name and company, vehicle plate (optional), purpose (feed delivery, gas, chick delivery, vet, buyer or catching crew, technician, other), "visited another poultry farm within `VISITOR_RECENT_FARM_HOURS`", and the entry checks: vehicle wheels disinfected, footbath and overshoes, farm clothing provided. Any member can record it, offline.
- **BS2. Zone.** A visitor who answered yes to the recent-farm question is allowed in the **dirty zone** only; the screen says so before saving and the record keeps `zone`. Others choose clean or dirty. The rule is a pure function shared by the phone and the server.
- **BS3. Today's visits.** The visitor screen lists today's visits of the farm (time, name, zone).
- **BS4. Clean-out.** After a batch closes, a house has a clean-out record (house, batch it follows) with the SCOPE §4 steps in order: manure removed, equipment dismantled and washed, high-pressure wash, disinfection (product, dose, product lot), rodent control with proof, water check and line flushing, litter and pre-heat. Each step is marked done with its farm day (and the step's fields); steps may be marked out of order but each once. Offline.
- **BS5. Downtime (vide sanitaire).** Downtime starts on the disinfection day. The screen shows "day N of M" since then, M being **planning's one figure** (SPEC-m5 PL5): the farm's rule in force, or the official 20 days (CQ3). Placing a batch too soon gives a **warning**, never a block: farm-wide for broilers and every other production type (fewer than M days since the farm's last end, or another house still holding a batch placed before that end, i.e. the previous cycle); house by house for table-egg layers. An end is the clean-out's disinfection day, else the last batch's removal (closing). The placement form, the clean-out screen and `/planning` read it through planning's `shared.ts`; `biosecurity` and `planning` are both L4 and do not import each other, so the screens (app layer) join flock's batches, biosecurity's clean-outs and planning's rule.
- **BS6. Dead-bird disposal.** A disposal records farm, farm day, batch (optional), birds, weight in grams (optional), method (`incineration`, `authorizedSite`, `other` + description). The screen shows each batch's mortality from the daily entries next to the birds disposed for the same days, so a gap is visible. Offline.
- **BS7. Manure.** A removal records farm, farm day, house and batch (optional), quantity in kg (integer), destination (`stored`, `spread`, `sold`, `given`), recipient (optional text). No money (out of scope §1). Offline.
- **BS8. Rodent control.** A check records farm, house (optional), farm day, action (`baitPlaced`, `baitChecked`), product (optional), and a proof photo (`proofFileId`, added online). Without a photo the record shows "preuve à ajouter".
- **BS9. Permissions.** `biosecurity.record`: owner, manager, worker (the worker's job, like daily entries). A farm's higher minimum downtime is planning's rule, entered by the owner (SPEC-m5 PL5, `organization.manage`); the former biosecurity setting (`DowntimeSetting`) is retired.

## 5. Requirements: `documents`

- **DC1. Vault.** A document has a title, category (`authorization`, `vetContract`, `labReport`, `insurance`, `land`, `company`, `tax`, `equipment`, `other`), farm (optional: the organisation as a whole), issue date and expiry date (both optional), notes, and zero or one file. Owner and manager create and edit them; workers neither see nor receive them (leases, tax papers).
- **DC2. Files.** Upload through `POST /api/files` (multipart, D3, D4), owner and manager, CSRF-protected like every route handler (poultry-auth). Download through `GET /api/files/<id>` for the same roles, or for any member when the file is a biosecurity proof. A file has an owner organisation, a content type, a size, a SHA-256 and the uploader.
- **DC3. States.** By expiry: `expired` (before today), `soon` (within `DOCUMENT_SOON_DAYS`, config, 60 from the mockup), `valid`, `none` (no expiry). The list is sorted by expiry, soonest first.
- **DC4. Expiry alerts.** The dispatch job (`POST /api/push/dispatch`) notifies owners and managers once at `DOCUMENT_SOON_DAYS` before expiry, once on the day, through `notifications` (`documentExpiring`, `documentExpired` templates, AR + FR). The farm's ONSSA authorization (SPEC F2) gets the same alerts even without a vault document.

## 6. Requirements: `reporting`

- **RP1. Register contents.** For one batch, the register holds what NEEDS-ANALYSIS §4 lists (law 49-99 art. 3 + arrêté of 15/12/2005): **cover**: farm name and address, ONSSA authorization number and expiry, house, species and strain, hatchery and chick delivery note, placement date and chicks placed, dead on arrival; **content**: daily mortality with cause and culls, birds on hand, feed (kg) and water (L) per day; vaccinations (age, product, product lot, method, who); treatments and vet prescriptions (product, dose, dates, prescriber, reason, withdrawal end); vet visits; birds out (sales: date, birds, farm weight, buyer when visible, origin-document number); dead-bird disposals (BS6). Lab reports: documents of category `labReport` for the farm during the batch (titles and dates). Built by one pure function `buildRegister`.
- **RP2. Register PDF.** `/register#<batch id>` is a static shell (precached, offline) that prints the register in the page's language (AR or FR), A4, with signature boxes for the farmer and the vet and the mention of §1. Any member can print it; money never appears in it.
- **RP3. Batch report.** `/report?batch=<id>`, online, owner and manager, printable: final or live KPIs (age, mortality %, FCR, EPEF, average weight vs the strain standard, ADG), birds placed / sold / dead, health summary (vaccinations done vs planned, treatments, withdrawal), sales (birds, kg, average price), the **finance result** (FN13: sales, costs, margin, margin and cost per kg), and the comparison with the farm's previous closed batches (mortality, FCR, cost/kg, margin/kg). Built by a pure function `buildBatchReport`.
- **RP4. Inspection pack.** `/inspection`, owner and manager, prints for one farm in one document: the authorization (F2), the vault's documents with their state, the registers of the open batches and those closed in the last 12 months (`INSPECTION_LOOKBACK_MONTHS`, config), clean-outs, visitor log, disposals, manure and rodent checks of the same period. Items missing are listed as missing (e.g. no rodent proof photo). Uploaded files are listed with their download link, not merged (CQ6). The pack's checklist is provisional (CQ2).

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
| `downtimeDay` | today − disinfection day + 1 (day 1 is the disinfection day) | disinfected 5 Nov, today 6 Nov → day 2; minimum 20 → ends 25 Nov |
| `placementDowntime` (planning) | placement day − last end < minimum (20 or the farm's higher rule); end = disinfection day, else removal; farm-wide except table-egg layers | farm-wide: ends 15 and 20 Oct, placement 5 Nov → warn (16); 9 Nov → none; another house holding a batch placed 2 Sep → warn "previous cycle". Layers: house ended 1 Oct, placement 25 Oct → none (24) |
| `documentState` | expired / soon / valid / none | expiry 30 Nov 2026, today 5 Nov, soon = 60 → `soon`; 15 Mar 2027 → `valid`; 1 Nov → `expired` |
| `buildRegister` daily rows | birds on hand = placed − DOA − cumulative dead and culls − sold, per day | B-2026-13: 10 000 placed, 26 Oct (J36) 4 dead → 9 620 → canvas row "9 620 · 4" |
| `buildRegister` withdrawal | treatment end + withdrawal days (health rule) | enrofloxacine 22–26 Oct, 5 days → 31 Oct |
| `disposalGap` | daily mortality − birds disposed, per day | 6 dead, 6 disposed → 0 |
| `buildBatchReport` comparison | per closed batch, newest first | margin/kg 1,87 for B-2026-13 (SPEC-finance §7) |

## 9. Open questions (for the owner, ONSSA, a private vet)

| # | Question | Blocks |
|---|---|---|
| CQ1 | **The official register template** (arrêté of 15/12/2005, number to confirm; Newcastle arrêté 3308-17): its columns, order, cover page and legal mentions | RP1–RP2 final layout; until then the provisional mention stays |
| CQ2 | The list of pieces an ONSSA inspector actually asks for (SCOPE §6 Q6) | RP4 checklist |
| CQ3 | The minimum downtime between batches (vide sanitaire), per species | **Decided default, to review (23 Nov 2026):** at least **20 days**, farm-wide between two successive batches; table-egg farms may do it house by house. Source: Arrêté n° 2127-05 du 15 décembre 2005 (BO n° 5392 du 2 février 2006, p. 239), art. 4: « un vide sanitaire d'au moins vingt jours doit être pratiqué au niveau de chaque ferme, entre deux bandes successives ». Built in (not seeded), counted from the disinfection day, else the removal; the owner may set a higher figure with a source, never a lower one (BS5, SPEC-m5 PL5). Out of scope: a Newcastle outbreak (21 days and ONSSA's agreement, arrêté n° 3308-17, art. 9-10° and 11) |
| CQ4 | Authorized dead-bird disposal methods and distances (art. 12; is a closed pit with quicklime accepted?) | BS6 method list |
| CQ5 | How long the register and biosecurity logs must be kept | Retention, deletion rules |
| CQ6 | Should the pack embed the uploaded PDFs? That needs a PDF library (ask first) | RP4 |
| CQ7 | Who must sign the register (farmer, vet sanitaire) and with what (stamp, registration number) | RP2 signature block |

## 10. Success criteria (compliance half of M2)

1. A demo batch prints a register in FR and AR, offline, with every RP1 section filled from the M1 data; the provisional mention shows until CQ1 is answered.
2. A worker logs a visitor, a disposal and a clean-out step offline; they reach the server once after sync.
3. A document due in 60 days notifies the owner once; a worker never receives documents.
4. The batch report's margin equals `/results` for the same batch.
5. `pnpm lint`, `pnpm typecheck`, `pnpm test` and each task's e2e spec pass.
