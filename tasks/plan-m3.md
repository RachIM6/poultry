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
- [ ] Seed check: no grade limit, protocol line or withdrawal value is committed (unit test over the seed files).
- [ ] A farm copies the layer template and adds a line at day 450 (integration test).
**Size:** S

### T53: Placement for every type (B7, B8)
**Description:** Production-type first in the form, strains filtered; `ageAtPlacementDays`; ages in weeks for long cycles; the one-open-batch rule generalised (beldi any, turkey one per sex) in the domain, the use case and the partial unique index.
**AC:**
- [ ] Two open broiler batches in one house are still refused; two beldi bands are accepted (integration test).
- [ ] A layer batch placed at 126 days shows "18 sem." on the phone (e2e, ar and fr).
**Size:** M

### T54: Turkey by sex (B9)
**Description:** `Batch.sex`; "sexes séparés" places two batches in one write; weighing compares with the curve of the batch's sex; the lot card shows both sexes.
**AC:**
- [ ] A female + male placement creates two batches; a third turkey batch in the house is refused (integration test).
- [ ] The male batch can be sold out and closed while the female one stays open (integration test).
**Size:** M

### T55: Chick arrival quality (B10)
**Description:** Optional placement fields: parent flock, supplement, weak chicks, litter temperature; density; DOA claim threshold per farm (empty by default).
**AC:**
- [ ] Birds started = billed + supplement − DOA (unit test); density shown (e2e).
- [ ] No claim message without a threshold; above a set threshold the placement shows it (unit test).
**Size:** S

### T56: Beldi run (B11)
**Description:** The batches list groups open bands of a run with age in weeks and birds on hand.
**AC:**
- [ ] Two bands in one run each take their daily entry offline and sync (e2e).
**Size:** S

### T57: Pullet uniformity and weekly standard (B12)
**Description:** `uniformityPercent(weights)` (±10 % of the mean) next to CV%; pullet weighings compare with the strain's weekly curve.
**AC:**
- [ ] Uniformity of a hand-computed sample (unit test).
**Size:** S

### T58: Transfer pullets → layers (B13)
**Description:** `flock.transferToLaying`: closes the pullet batch, records the birds left behind as culled, places the layer batch with age carried over and `fromBatchId`; finance skips the transfer's chick purchase.
**AC:**
- [ ] One mutation, idempotent; the layer batch's age continues the pullet batch's (integration test).
- [ ] No chick-purchase entry is posted for the layer batch (integration test).
**Size:** M

### T59: Eggs module and collection (E1)
**Description:** New strict module `eggs`: `EggCollection`, record + correct offline (workers), audit, change log, collection screen with steppers (P-EggCollect).
**AC:**
- [ ] Three collections on one day sum into the day's total; a correction is audited (integration test).
- [ ] Recorded offline, reloaded, synced (e2e, ar and fr).
**Size:** M

### T60: Egg stock, grading, discard (E2–E4)
**Description:** `EggMovement` ledger written by collections, grading and discards; stock by item and age bucket (P-EggStock).
**AC:**
- [ ] Grading more than a day's ungraded eggs is refused; a corrected collection corrects its movements without duplicates (integration test).
- [ ] Age buckets of a hand-made ledger (unit test).
**Size:** M

### T61: Layer KPIs, water/feed ratio (E5, B14)
**Description:** Pure `layerKpis` (hens on hand, hen-day rate, eggs per hen housed, egg weight, feed per egg, downgraded %, weekly rows, vs standard) and the water/feed ratio; the layer batch screen.
**AC:**
- [ ] Hand-computed fixture for a week of collections (unit test).
**Size:** M

### T62: Egg withdrawal on treatments (H7)
**Description:** `Treatment.eggWithdrawalDays` + `eggWithdrawalEndsOn`, required on layer batches; banner.
**AC:**
- [ ] A layer-batch treatment without egg withdrawal days is refused (integration test); banner shows (e2e).
**Size:** S

### T63: Egg sales (V6)
**Description:** `Sale.kind = eggs`, `SaleLine`, FIFO draw from the egg ledger, withdrawal block, receivables as V2.
**AC:**
- [ ] FIFO draw over two laying days (unit test); amount with 30 and 12 eggs per tray (unit test).
- [ ] A sale drawing eggs laid during a withdrawal is refused with the days to discard (integration test).
**Size:** M

### T64: Sale per head (V7)
**Description:** Per-head lines on live sales (rooster, hen, bird), farm weight optional for them; P-Beldi screen.
**AC:**
- [ ] 6 roosters × 85,00 + 4 hens × 70,00 = 790,00 DH, birds on hand −10 (integration test, e2e).
- [ ] The meat withdrawal still blocks a per-head sale (integration test).
**Size:** S

### T65: Finance postings for egg and per-head sales (V8)
**Description:** FN6 rules: egg sale → 71213 (fallback 7121), per-head → as live sales.
**AC:**
- [ ] With PCA on, an egg sale posts D 3421 / C 71213; with PCA off, C 7121 (unit test).
**Size:** S

### T66: Owner overview (D1)
**AC:**
- [ ] One farm with a broiler, a layer and a beldi run shows each house's figures (e2e).
**Size:** M

### T67: Batch comparison (D2)
**AC:**
- [ ] Two closed broiler batches compared with their locked KPIs (e2e).
**Size:** S

### T68: M3 offline journey (success criteria 1, 2)
**AC:**
- [ ] Pullets → transfer → collections → grading → egg sale → old-hen sale, offline, ar and fr (e2e). The M1 journey still passes.
**Size:** M

### T69: Reserved

## Source documents needed (SPEC-m3 §5)

To ask the owner for; nothing is invented meanwhile:
1. Turkey growth and feed standards **per sex** for the strains used (e.g. Aviagen BUT 6 performance goals).
2. Layer management guide of each strain used (e.g. Lohmann Brown): pullet body weight by week, laying curve (hen-day %, eggs per hen housed, egg weight, feed per hen per day).
3. Moroccan egg grade limits and marking / labelling rules (law 49-99 art. 3-2°, 16; the NM standard if any).
4. Vaccination protocols per species (turkey, pullet/layer, beldi, duck, quail), reviewed by a vet.
5. Egg withdrawal days of the medicines used on layers, and a vet's view of the egg-sale block.
6. Feed phases and transition ages per species.
7. The hatchery contract's dead-on-arrival claim threshold.
