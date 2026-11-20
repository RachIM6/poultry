# Implementation plan: M3 all production types

_v0.1, 16 Nov 2026. Status: **draft**. Implements [SPEC-m3.md](../SPEC-m3.md). Task ids T50–T69 (T40–T49 belong to the M2-compliance plan). Stacked on `feat/t38-export` (PR #44): each task's branch `feat/t<N>-<slug>` starts from the previous one._

Definition of done, layout (strict modules: `domain/`, `application/`, `infrastructure/`; `eggs` is strict) and verification commands are those of [todo.md](todo.md). Each task: domain test → integration test → page → Playwright spec, then `pnpm lint && pnpm typecheck && pnpm test` and its e2e. Reference values are never committed (SPEC-m3 §4): tests use synthetic fixtures.

## Dependency graph

```
T50 types + strains ── T51 curves v2 ── T57 pullet uniformity ── T58 transfer ──┐
        │                    └────────── T54 turkey by sex                     │
        ├── T52 grades, templates, egg withdrawal on products                  │
        └── T53 placement generalised ── T55 chick arrival ── T56 beldi run    │
T59 eggs + collection ── T60 stock + grading ── T61 layer KPIs ◄──────────────┘
T52 ── T62 egg withdrawal ── T63 egg sales ── T65 finance postings
T53 ── T64 sale per head ──────────────────────┘
T61 + T64 ── T66 owner overview ── T67 comparison ── T68 M3 journey e2e
T69 reserved for what the build turns up
```

## Tasks

### T50: Production types and strain catalogue (R5)
**Description:** `PRODUCTION_TYPES` in `reference-data/shared.ts`; `Strain.productionTypes`; seed the "non précisée" strain per type and the strains named in the project docs (BUT 6, Lohmann Brown), no curves. `BatchDto.species` widens to every type; placement checks the strain serves the type.
**AC:**
- [x] Existing Ross 308 / Cobb 500 rows become `broiler` strains; existing batches stay `broiler` (migration test). (`Strain.productionTypes` defaults to `{broiler}`; a placement queued by an M1 phone has no `species` and is a broiler: `flock/batches.int.test.ts`.)
- [x] Placing a batch with a strain of another type is refused (`INVALID_INPUT`). (Same test; `reference-data.strainServes` replaces `isStrain`.)

Done 2026-11-16 (branch `feat/t50-production-types`): the placement form asks the production type first and lists only its strains (`e2e/batches.spec.ts`); batch titles start with the type. "Non précisée" strains are translated on the phone (`Batches.unspecifiedStrain`), whatever their seeded name. Seeded strains: Ross 308, Cobb 500 (M1), BUT 6 and Lohmann Brown (named on the mockups), one "non précisée" per type (MQ10). No curve.
**Files:** `prisma/schema.prisma`, `prisma/seed/reference/strains.json`, `src/modules/reference-data/*`, `src/modules/flock/application/place-batch.ts`
**Size:** S

### T51: Growth curves by sex, laying curves (R6, R7)
**Description:** `StandardCurve.sex`, `LayingCurve` + `LayingPoint` (week, rate ‰, eggs per hen housed, egg weight dg, feed g/hen/day, body weight g), import format in `prisma/seed/reference/curves/README.md`, pure `layingStandardAt`. Offline reference payload carries them.
**AC:**
- [x] `layingStandardAt` returns exact weeks, interpolates between published weeks and returns null outside (unit test, synthetic fixture). (`reference-data/schema.test.ts`; a column missing on either side stays null.)
- [x] A curve file with a sex imports and is served by `GET /api/reference` (integration test, fixture loaded by the test, not the seed). (`reference-data/curves.int.test.ts`, through `getReferenceData`, which the route serves.)

Done 2026-11-16 (branch `feat/t51-curves-v2`): `StandardCurve.sex` (unique per strain, version and sex; existing curves are `mixed`), `LayingCurve` + `LayingPoint` (integers: ‰, tenths of an egg, decigrams, grams). `curveFor(curves, sex)` picks the latest curve of the sex, else the latest mixed one; the batch screen uses it. Growth curves accept days up to 600 for weekly guides (day = week × 7). Import formats: `prisma/seed/reference/curves/README.md` and `laying/README.md`. **No value committed** (MQ1).
**Size:** M

### T52: Egg grades, protocol templates per type, egg withdrawal on products (R8–R10)
**Description:** `EggGrade` (id, labels, min/max grams nullable), seeded S/M/L/XL with null limits; one empty, unreviewed protocol template per production type; protocol line `dayOfAge` up to 600; `Product.eggWithdrawalDays` nullable.
**AC:**
- [x] Seed check: no grade limit, protocol line or withdrawal value is committed (unit test over the seed files). (`reference-data/seed.test.ts`, also no curve file.)
- [x] A farm copies the layer template and adds a line at day 450 (integration test). (`reference-data/protocols.int.test.ts`; day 601 is refused.)

Done 2026-11-16 (branch `feat/t52-grades-templates`): `EggGrade` (S, M, L, XL as on P-EggStock, limits null), `ProtocolTemplate.productionType`, `Product.eggWithdrawalDays`; all in `GET /api/reference` (`eggGrades`). The protocol screen lists the 7 templates; `e2e/protocol.spec.ts` copies the broiler one.
**Size:** S

### T53: Placement for every type (B7, B8)
**Description:** Production-type first in the form, strains filtered; `ageAtPlacementDays`; ages in weeks for long cycles; the one-open-batch rule generalised (beldi any, turkey one per sex) in the domain, the use case and the partial unique index.
**AC:**
- [x] Two open broiler batches in one house are still refused; two beldi bands are accepted (integration test). (`flock/batches.int.test.ts`; the partial unique index now skips beldi, `canJoinHouse` in the domain.)
- [x] A layer batch placed at 126 days shows "18 sem." on the phone (e2e, ar and fr). (`e2e/production-types.spec.ts`, offline, with two beldi bands in one run.)

Done 2026-11-16 (branch `feat/t53-placement-all-types`): `Batch.ageAtPlacementDays` (0 for every M1 row), asked in weeks for every type but broiler. `ageOfBatch` gives the birds' age everywhere (KPIs, weighing standard, origin document). The vaccination plan of birds placed older skips the lines due before they arrived and dates the rest from their age (`health/domain/vaccination.test.ts`). Turkey sexes come in T54.
**Size:** M

### T54: Turkey by sex (B9)
**Description:** `Batch.sex`; "sexes séparés" places two batches in one write; weighing compares with the curve of the batch's sex; the lot card shows both sexes.
**AC:**
- [x] A female + male placement creates two batches; a third turkey batch in the house is refused (integration test). (`flock/batches.int.test.ts`; a mixed one too.)
- [x] The male batch can be sold out and closed while the female one stays open (integration test). (Closed by hand in the test; selling out goes through the same `Batch.close`.)

Done 2026-11-16 (branch `feat/t54-turkey-sexes`): `Batch.sex` (mixed for every M1 row; only turkeys may be sexed). "Sexes séparés" in the form places one batch per sex with its own count and dead on arrival, each with the protocol's plan. The unique index is now on (house, sex). Each batch compares with its sex's curve (`curveFor`); its screen links to the other sex's batch with its birds on hand (`e2e/production-types.spec.ts`). The P-Turkey weekly table per sex waits for curves (MQ1).
**Size:** M

### T55: Chick arrival quality (B10)
**Description:** Optional placement fields: parent flock, supplement, weak chicks, litter temperature; density; DOA claim threshold per farm (empty by default).
**AC:**
- [x] Birds started = billed + supplement − DOA (unit test); density shown (e2e). (`flock/domain/batch.test.ts` with P-ChickArrival's 10 000 + 200 − 14 = 10 186; `e2e/production-types.spec.ts` shows 10,2 sujets/m².)
- [x] No claim message without a threshold; above a set threshold the placement shows it (unit test). (`doaClaim`: strictly above, per mille of the chicks delivered.)

Done 2026-11-16 (branch `feat/t55-chick-arrival`): `Batch.freeChicks`, `parentFlock`, `weakChicks`, `litterTempTenths` (all optional; the supplement and weak chicks are not asked for a sexed placement); `Farm.doaClaimThresholdPermille`, entered in % on the farm form, empty by default (MQ6). `birdsStarted` is the one rule for birds started everywhere (screens, KPIs, sales, finance's bird-days). The free supplement is not billed: the chick cost stays billed × price.
**Size:** S

### T56: Beldi run (B11)
**Description:** The batches list groups open bands of a run with age in weeks and birds on hand.
**AC:**
- [x] Two bands in one run each take their daily entry offline and sync (e2e). (`e2e/production-types.spec.ts`: one dead each, the run heading drops from 270 to 268 birds, 2 synced.)

Done 2026-11-16 (branch `feat/t56-beldi-run`): the batches list keeps a run's open bands together, oldest first, under "Parcours · 2 bandes · 270 sujets". Asked by the UI session: the "Aujourd'hui" home and the day strip now serve every type instead of forking them: long cycles show a rolling 42-day window (35 days back, 7 ahead), ages in weeks (`components/batch-age.ts`, shared with the batches list), the type for a "non précisée" strain and the sex of a turkey batch.
**Size:** S

### T57: Pullet uniformity and weekly standard (B12)
**Description:** `uniformityPercent(weights)` (±10 % of the mean) next to CV%; pullet weighings compare with the strain's weekly curve.
**AC:**
- [x] Uniformity of a hand-computed sample (unit test). (`flock/domain/weighing.test.ts`: 5 of 6 within ±10 % → 83,3 %; the band's edges count in.)

Done 2026-11-16 (branch `feat/t57-pullet-uniformity`): `uniformityPercent` (band `UNIFORMITY_BAND_PERCENT` = 10, MQ9) next to the CV on every non-broiler weighing (`e2e/production-types.spec.ts`, a pullet batch at 11 weeks). The weekly standard needs no new code: a pullet guide is imported as days (week × 7) and `standardAt` + `curveFor` already compare with it; no curve is loaded (MQ1).
**Size:** S

### T58: Transfer pullets → layers (B13)
**Description:** `flock.transferToLaying`: closes the pullet batch, records the birds left behind as culled, places the layer batch with age carried over and `fromBatchId`; finance skips the transfer's chick purchase.
**AC:**
- [x] One mutation, idempotent; the layer batch's age continues the pullet batch's (integration test). (`flock/transfer.int.test.ts`: replay, another organisation, too many hens, an occupied laying house, the 95 left behind culled.)
- [x] No chick-purchase entry is posted for the layer batch (integration test). (Its chick price is 0, and finance's rules post nothing for a zero amount (`finance/domain/posting.ts`, already tested); no finance change.)

Done 2026-11-16 (branch `feat/t58-transfer-to-laying`): `flock.transferToLaying` (owner, manager) culls the birds left behind on the day's entry, closes the pullet batch with the reason code `transferToLaying` (shown "Passée en ponte"), and places a layer batch with `fromBatchId`, the pullets' strain, hatchery and delivery note, and their age. The pullet batch keeps its costs. "Passage en ponte" form on an open pullet batch, offline (`e2e/production-types.spec.ts`).
**Size:** M

### T59: Eggs module and collection (E1)
**Description:** New strict module `eggs`: `EggCollection`, record + correct offline (workers), audit, change log, collection screen with steppers (P-EggCollect).
**AC:**
- [x] Three collections on one day sum into the day's total; a correction is audited (integration test). (`eggs/collections.int.test.ts`, by a worker; also a pullet batch refused, another organisation's, a closed batch's correction.)
- [x] Recorded offline, reloaded, synced (e2e, ar and fr). (`e2e/eggs.spec.ts`: P-EggCollect's 1 713 eggs, a second collection corrected, the Arabic screen.)

Done 2026-11-16 (branch `feat/t59-egg-collection`): new strict module `eggs` (domain / application / infrastructure, `eggs.record` for owners, managers and workers), `EggCollection` table, `eggs.recordCollection` and `eggs.correctCollection` (the day and batch stay; old counts audited). Steppers on a layer batch's screen: normal eggs by 30 (a tray), the rest by 1; any count can be typed. No egg stock yet: T60.
**Size:** M

### T60: Egg stock, grading, discard (E2–E4)
**Description:** `EggMovement` ledger written by collections, grading and discards; stock by item and age bucket (P-EggStock).
**AC:**
- [x] Grading more than a day's ungraded eggs is refused; a corrected collection corrects its movements without duplicates (integration test). (`eggs/stock.int.test.ts`; a correction that would take back graded eggs is refused.)
- [x] Age buckets of a hand-made ledger (unit test). (`eggs/domain/stock.test.ts`.)

Done 2026-11-16 (branch `feat/t60-egg-stock`). Decision: **no movement table**. Stock is computed (`eggLots`) from the records that already sync and are kept as entered: collections, `EggGrading` ({ grade: eggs } per batch and laying day) and `EggDiscard`; sales will add the eggs they draw (T63). The phone and the server run the same function, offline, with no second id to reconcile. Stock changes of a batch are serialized by an advisory lock. Grade ids are checked as slugs only: `eggs` may not depend on `reference-data` (CAPABILITY-MAP); the phone lists the reference grades. Eggs of a closed batch stay in stock. Page `/eggs` (P-EggStock, precached, linked from "Plus" and the layer batch): totals and trays of 30 (display only, MQ8), stock by grade with the "limits to confirm" note (MQ2), by age (0–2, 3–5, 6+ days), lots with "Calibrer" and "Écarter" (`e2e/eggs.spec.ts`).
**Size:** M

### T61: Layer KPIs, water/feed ratio (E5, B14)
**Description:** Pure `layerKpis` (hens on hand, hen-day rate, eggs per hen housed, egg weight, feed per egg, downgraded %, weekly rows, vs standard) and the water/feed ratio; the layer batch screen.
**AC:**
- [x] Hand-computed fixture for a week of collections (unit test). (`eggs/domain/kpi.test.ts`: 100 hens, 2 days, 3 collections; `flock/domain/kpi.test.ts` for the water/feed ratio.)

Done 2026-11-16 (branch `feat/t61-layer-kpis`): `layerKpis` (pure): hens on hand, hen-day rate of the latest collected day (eggs ÷ hens that morning), eggs per hen housed, egg weight from samples, feed per egg, downgraded %, weekly rows by the birds' age (rate over hen-days, feed g/hen/day, water/feed). Layer batches show `LayerDashboard` (P-Layers tiles + the last 5 weeks) instead of the broiler KPIs; the standard shows once a laying curve is loaded (MQ1). Every other batch gets an "Eau / aliment" tile (`waterPerFeed`, B14). The P-Layers alert "baisse de ponte" needs a threshold: left for T69 if wanted.
**Size:** M

### T62: Egg withdrawal on treatments (H7)
**Description:** `Treatment.eggWithdrawalDays` + `eggWithdrawalEndsOn`, required on layer batches; banner.
**AC:**
- [x] A layer-batch treatment without egg withdrawal days is refused (integration test); banner shows (e2e). (`health/treatments.int.test.ts` → `EGG_WITHDRAWAL_REQUIRED`; `e2e/eggs.spec.ts` offline.)

Done 2026-11-17 (branch `feat/t62-egg-withdrawal`): `Treatment.eggWithdrawalDays` + `eggWithdrawalEndsOn` (null for every M1 row and every non-layer batch); `checkTreatment` requires it on layer batches, phone and server. `eggWithdrawalUntil` (the H4 rule with the egg days) drives a second banner, "Œufs à retirer de la vente jusqu’au …". For T63, `health.eggWithdrawalWindowsOf(batch)` gives each treatment's laying days whose eggs can't be sold: from its first day to its egg withdrawal's last. ⚠️ MQ4: a vet confirms the rule.
**Size:** S

### T63: Egg sales (V6)
**Description:** `Sale.kind = eggs`, `SaleLine`, FIFO draw from the egg ledger, withdrawal block, receivables as V2.
**AC:**
- [x] FIFO draw over two laying days (unit test); amount with 30 and 12 eggs per tray (unit test). (`eggs/domain/stock.test.ts`, `sales/domain/sale.test.ts`: P-EggStock's 1 080 trays × 33,00 = 35 640,00 DH.)
- [x] A sale drawing eggs laid during a withdrawal is refused with the days to discard (integration test). (`sales/egg-sales.int.test.ts` → `EGGS_IN_WITHDRAWAL`, "écartez-les avant de vendre"; the message names no days: the lot list on /eggs shows them.)

Done 2026-11-17 (branch `feat/t63-egg-sales`). Decisions:
- An egg sale **is a `Sale`** with `kind = "eggs"` (birds, weights and price per kg at 0) and its `SaleLine`s, so receivables, cheques and bills, credit blocks and limits, and finance postings apply unchanged.
- It names **one laying batch** and draws FIFO within it (SPEC said "across the farm's batches": per batch keeps the withdrawal check exact; a farm with two laying houses makes two sales).
- The eggs it takes are `EggDraw` rows **owned by `eggs`** (`eggs.drawEggs` from the sale's transaction; sales passes health's windows, as eggs may not depend on health). Draw ids are UUIDv5 of the sale, the same on the phone.
- `/eggs`: "Vendre des œufs" (owners, managers): buyer, lines (item, trays, eggs per tray 30 by default, price per tray), payment as V2; the phone runs the same checks and draw. Batch screens no longer list egg sales.
- Until T65, finance posts an egg sale like a live sale.
**Size:** M

### T64: Sale per head (V7)
**Description:** Per-head lines on live sales (rooster, hen, bird), farm weight optional for them; P-Beldi screen.
**AC:**
- [x] 6 roosters × 85,00 + 4 hens × 70,00 = 790,00 DH, birds on hand −10 (integration test, e2e). (`sales/head-sales.int.test.ts`, `e2e/production-types.spec.ts` offline on a beldi band.)
- [x] The meat withdrawal still blocks a per-head sale (integration test). (`WITHDRAWAL_IN_PROGRESS`, same `withdrawalOn` as V3.)

Done 2026-11-17 (branch `feat/t64-per-head-sales`): `sales.recordHeadSale`: a `Sale` of `kind = "perHead"` with up to 3 lines (roosters, hens, birds) and their price per head, farm weight optional; the birds leave the batch through flock (B5, closes it with the last ones). Lines reuse `SaleLine` with a pack of 1 (`eggs` counts birds then): renaming the column would be an "ask first" migration. The sale form has "Au kg / À la tête", per head by default for beldi and quail. Old hens are sold per kg or per head from the layer batch, no new code.
**Size:** S

### T65: Finance postings for egg and per-head sales (V8)
**Description:** FN6 rules: egg sale → 71213 (fallback 7121), per-head → as live sales.
**AC:**
- [x] With PCA on, an egg sale posts D 3421 / C 71213; with PCA off, C 7121 (unit test). (`finance/domain/posting.test.ts`; `finance/egg-postings.int.test.ts` through the sync push and `postPending`, with the cash received.)

Done 2026-11-17 (branch `feat/t65-egg-postings`): `salesChangedSince` carries the sale's kind; FN6's sale rule credits 71213 for eggs (label "Vente d’œufs"), 712121 for live and per-head sales. 71213 and its fallback 7121 were already in the seeded chart (T28). ⚠️ The accountant reviews it with the other FN6 rules (ADR-010).
**Size:** S

### T66: Owner overview (D1)
**AC:**
- [x] One farm with a broiler, a layer and a beldi run shows each house's figures (e2e). (`e2e/production-types.spec.ts`: "Jour 3 sur 42", the layers' laying rate and yesterday's 1 713 eggs, "21 sem. 3 j" for the band.)

Done 2026-11-17 (branch `feat/t66-owner-overview`, with the UI chain's U12 merged): **no second dashboard**. The design session owns the home ("Aujourd'hui", WebOverview on wide screens, the owner's "Argent" card); M3 extends it: each layer batch shows its latest laying rate and eggs under its strip, and a card counts yesterday's eggs on the farm. Ages in weeks and type labels came with T56. Not done from P-Owner: weight vs standard and FCR per broiler house on the home (they need a weighing and a curve: the batch screen has them), uniformity for pullets, farm filter (the home already follows the farm of the open batches).
**Size:** M

### T67: Batch comparison (D2)
**AC:**
- [x] Two closed broiler batches compared with their locked KPIs (e2e). (`e2e/production-types.spec.ts`, offline after a reload; `flock/domain/kpi.test.ts` for the figures.)

Done 2026-11-17 (branch `feat/t67-batch-comparison`): `closedBatchFigures` (pure): livability, average weight sold, age at close, FCR = feed ÷ kg sold, EPEF, day-7 mortality. Page `/compare` (precached, in "Plus"): closed batches of a chosen production type, newest first, with hatchery, day-old weight and the locked cost per kg (money: absent for workers). Not done from P-Compare: the feed-supplier cost per kg live and the hatchery claims table (they need the feed items' suppliers per batch: a later task), the Excel export. Budget: `/fr/batches` 199.8 KB.
**Size:** S

### T68: M3 offline journey (success criteria 1, 2)
**AC:**
- [x] Pullets → transfer → collections → grading → egg sale → old-hen sale, offline, ar and fr (e2e). The M1 journey still passes. (`e2e/m3-journey.spec.ts`, every label from the message files; the whole suite, 60 tests, passes: 13 needed a single-worker re-run because the database's transactions expired under load with the disk at 98 %.)

Done 2026-11-17 (branch `feat/t68-m3-journey`). The Arabic run found a real bug: on a phone the egg-collection steppers overflowed and covered the save button; the rows now shrink (label column `min-w-0`, fixed-size buttons and input).

SPEC-m3 §6 success criteria: 1 ✔ (this journey), 2 ✔ (`e2e/production-types.spec.ts`: turkeys by sex, beldi bands, per-head sale), 3 ✔ (every requirement has a unit or integration test), 4 ✔ (M1 journey unchanged, ar and fr).
**Size:** M

### T69: Reserved

Left for later (from the build, none blocking): a "laying below standard" alert (needs a threshold and a loaded curve), P-Compare's feed-supplier table (a feed item mixes suppliers' deliveries, so a batch's feed can't be traced to one supplier without lots by supplier), ~~the hatchery table~~ (done 2026-11-20, branch `feat/hatchery-compare`: batches, day-old weight, pooled day-7 mortality and claims, a claim being dead on arrival above the farm's threshold), per-house weight vs standard on the home, ~~the grade ids checked against reference data~~ (done 2026-11-20, branch `fix/egg-grade-ids`: `gradeEggs` refuses a grade the reference data doesn't have, `INVALID_INPUT`; `eggs` → `reference-data` in CAPABILITY-MAP and the lint rule), renaming `SaleLine.eggs` to a neutral name (an "ask first" migration).

## Source documents needed (SPEC-m3 §5)

To ask the owner for; nothing is invented meanwhile:
1. Turkey growth and feed standards **per sex** for the strains used (e.g. Aviagen BUT 6 performance goals).
2. Layer management guide of each strain used (e.g. Lohmann Brown): pullet body weight by week, laying curve (hen-day %, eggs per hen housed, egg weight, feed per hen per day).
3. Moroccan egg grade limits and marking / labelling rules (law 49-99 art. 3-2°, 16; the NM standard if any).
4. Vaccination protocols per species (turkey, pullet/layer, beldi, duck, quail), reviewed by a vet.
5. Egg withdrawal days of the medicines used on layers, and a vet's view of the egg-sale block.
6. Feed phases and transition ages per species.
7. The hatchery contract's dead-on-arrival claim threshold.
