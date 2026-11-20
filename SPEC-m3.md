# Spec: M3 "All production types"

_v0.1, 16 Nov 2026. Status: **draft**. Milestone M3 of [CAPABILITY-MAP.md](CAPABILITY-MAP.md): turkey, beldi, ducks / quail, pullets → layers with eggs. Modules: `reference-data` (all species), `flock` variants, `eggs`, `sales` (eggs, old hens). Screens: Design canvas pages P-Turkey, P-Layers, P-Pullets, P-Beldi, P-EggCollect, P-EggStock, P-ChickArrival, P-Compare, P-Owner (French only). Conventions, stack and boundaries of [SPEC.md](SPEC.md) apply unchanged. Plan: [tasks/plan-m3.md](tasks/plan-m3.md)._

## 1. Objective

The M1 broiler flow (placement → daily entry → weighing → vaccines → sale → closing) works for **every production type of the MVP**, and layer farms get **eggs**: collection, grading, stock, sales. Old hens (réforme) and beldi birds sell by the head.

**Users:** the same as M1 (owner, manager, worker). Workers enter collections and see egg counts, never prices (I5).

**Out of scope:** breeders and hatchery (post-MVP), egg packing centre, lighting programme screen, the "préparer le passage en ponte" checklist (it is the vaccination plan plus notes until a vet gives a template), biological-asset accounting of pullets (M6, ADR-010), anonymous comparison with other farms.

## 2. Production types

| Type id | French label | Cycle (from SCOPE §2) | Grouping | Sold as |
|---|---|---|---|---|
| `broiler` | Poulet de chair | ~35–50 days | one batch per house | live, per kg |
| `turkey` | Dinde | ~12–20 weeks, sexes apart | one batch per sex, both in the same house | live, per kg, per sex |
| `pullet` | Poulette | 0 → ~18 weeks | one batch per house | transferred to a laying house |
| `layer` | Pondeuse | ~18 → 80+ weeks | one batch per house | eggs; old hens per kg or per head |
| `beldi` | Beldi / plein air | variable, mixed ages | several bands (batches) in one run | per head, by sex |
| `duck` | Canard | per species | one batch per house | live, per kg or per head |
| `quail` | Caille | per species | one batch per house | per head |

The type is stored on the batch (column `Batch.species`, values above; every existing row is `broiler`).

## 3. Requirements

### `reference-data`
- **R5. Production types and strains.** The catalogue lists the production types of §2. A strain belongs to one or more production types. Each type has one strain "non précisée" for farms that don't know theirs; it has no curve. Strain names come only from the project documents (SCOPE §6, the mockups); no other strain is seeded.
- **R6. Growth standards by sex and by week.** A growth curve has a sex (`mixed` · `female` · `male`). Points are by day of age, as in R1; a guide published by week is imported as day = week × 7. Same import format, source and version per file; nothing committed until the source document is supplied.
- **R7. Laying standards.** A laying curve has, per week of age: hen-day laying rate (‰), cumulative eggs per hen housed, average egg weight (decigrams), feed per hen per day (g), body weight (g). Lookup `layingStandardAt(points, week)`: exact or linear between published weeks, never extrapolated. Nothing committed until the source document is supplied.
- **R8. Egg grades.** Grade classes (S, M, L, XL as on P-EggStock) with min and max weight in grams **null until the Moroccan standard is supplied**. Grading by class works without the limits; the limits are shown once known.
- **R9. Vaccination protocol templates per production type.** One empty template per type, flagged "not reviewed by a vet" (OQ4). Protocol lines may go up to day 600 (85 weeks) for layers.
- **R10. Egg withdrawal.** A catalogue product may carry an **egg withdrawal period** in days, null until known (never a default).

### `flock`
- **B7. Placement for every type.** The placement form asks the production type first, then shows its strains only. A batch may start at an age other than day 0 (`ageAtPlacementDays`: bought started pullets or point-of-lay hens). Ages are shown in days for broilers and in weeks (+ days) for the other types.
- **B8. One open batch per house, generalised.** In a house: one open batch, except **beldi** (any number of bands) and **turkey** (one female + one male batch of the same placement). Enforced by the use case and a partial unique index on (house, sex) for non-beldi batches.
- **B9. Turkey by sex.** A turkey placement with "sexes séparés" creates two batches (female, male) in one go, linked by house and placement day. Each has its daily entry, weighings against the curve of its sex, sales and closing (two sale dates). The lot screen shows both sexes side by side and the cumulative FCR per sex.
- **B10. Chick arrival quality** (P-ChickArrival). Optional at placement: parent flock number, free extra chicks (supplement), weak chicks, litter temperature (°C). Birds placed = billed + supplement − dead on arrival. Shows the density (birds/m²). **A DOA claim threshold per farm**, empty by default: when set and exceeded, the placement shows "réclamation au couvoir".
- **B11. Beldi run.** A run (house) shows its open bands with age in weeks and birds on hand; each band has the M1 daily entry.
- **B12. Pullet rearing.** Weekly weighing (B3) shows the **uniformity %** (share of individual weights within ±10 % of the mean) besides CV%, and the gap to the pullet standard of the strain by week.
- **B13. Transfer pullets → layers.** One action on an open pullet batch: day, laying house, hens transferred. It closes the pullet batch (reason "transfert en ponte"; birds not transferred are recorded as culled that day) and places a layer batch in the laying house with the age carried over and `fromBatchId`. The layer batch's chick cost is 0: its purchase is not posted again (finance), the pullet batch keeps its costs.
- **B14. Water / feed ratio.** The batch screen shows the day's water ÷ feed when both are entered, for every type.

### `eggs` (new module, L4: depends on `flock`, `inventory`)
- **E1. Collection** (P-EggCollect). Several collections per layer batch per farm day, each with counts: normal, cracked, dirty, double-yolk, floor, broken, and optionally a sample of eggs weighed (count + total grams). Offline, by workers. A collection can be corrected until the batch closes; corrections are audited.
- **E2. Egg stock ledger.** Stock is a ledger of movements per farm, batch, laying day and item (`ungraded`, `downgraded`, `grade:<id>`), never edited in place. A collection adds normal + double-yolk as `ungraded` and cracked + dirty + floor as `downgraded`; broken eggs are lost. Stock on hand = sum of movements.
- **E3. Grading** (P-EggStock). Grading a laying day of a batch moves eggs from `ungraded` to grade classes; the counts can't exceed the ungraded eggs of that day. Discarding (with a reason) takes eggs out of any item.
- **E4. Stock view.** Eggs on hand by item and by age buckets (0–2, 3–5, 6+ days since laying), in eggs and in trays of 30 (display only).
- **E5. Layer KPIs** (P-Layers), computed on the phone and the server with the same pure code: hens on hand, hen-day laying rate (eggs collected that day ÷ hens on hand), eggs per hen housed (cumulative ÷ hens at placement), average egg weight (from samples), feed per egg, downgraded % (cracked + dirty + floor + broken over all eggs), weekly table and comparison with the laying standard when one is loaded.

### `health`
- **H7. Egg withdrawal.** A treatment of a layer batch also records the egg withdrawal days (from the label or the prescription, required, never a default). Egg withdrawal end = end day + egg withdrawal days. The batch shows "œufs à retirer jusqu'au …" while it runs. ⚠️ Vet to validate (OQ4).

### `sales`
- **V6. Egg sales** (P-EggStock). A sale of eggs: farm, buyer, day, lines (item, eggs, price per tray of `eggsPerTray` eggs, default 30), payment as V2. Amount = Σ round(eggs × price ÷ eggsPerTray). Eggs are drawn from stock **oldest laying day first** (FIFO) across the farm's batches. Refused when stock is short, and **refused when an egg it would draw was laid during an egg withdrawal of its batch** (between the treatment's start and its egg withdrawal end), with the days to discard first. Workers never see prices.
- **V7. Sale per head.** A sale of live birds may be priced **per head**, by lines (`rooster`, `hen`, `bird`) with a count and a price per head (P-Beldi). The farm weight becomes optional for it. The meat withdrawal block (V3) and birds on hand (B5) apply unchanged. Used for beldi, quail, ducks and old hens (réforme); old hens may also be sold per kg (V2).
- **V8. Receivables and finance.** Egg and per-head sales join receivables, cheques and bills exactly like V2 sales. Finance posts them (FN6): egg sales to PCA 71213 "Ventes de produits d'animaux", per-head sales like live sales (712121); fallback 7121 without PCA.

### Overview and comparison (UI only, no new module)
- **D1. Owner overview** (P-Owner). The dashboard lists every farm's houses with type-specific figures: broiler and turkey (birds, weight vs standard, FCR), pullet (birds, weight vs standard, uniformity), layer (hens, laying rate vs standard, eggs per day), beldi (bands, birds). Eggs collected yesterday in the headline figures.
- **D2. Batch comparison** (P-Compare). Closed batches of one production type side by side: livability, average weight, age, FCR, EPEF, cost per kg, chick supplier (hatchery) with day-1 weight and day-7 mortality.

### Cross-cutting
- **X5.** Every M3 action works offline and syncs idempotently (X1, X2). Existing broiler data stays valid through every migration; no column is dropped or renamed.
- **X6.** Every new screen exists in Arabic (RTL) and French. Touch targets ≥ 44 px (X4). New screens stay structurally simple (Tailwind, semantic HTML) until the design system lands.

## 4. Never invent reference data

Growth and laying curves, egg grade limits, vaccination protocols per species, feed phases and withdrawal days are **imported from a named source document or left empty**. The code, import format, seed and lookup are built and tested with synthetic fixtures in tests only; no value is committed to `prisma/seed`.

## 5. Open questions

| # | Question | Default taken (safe) | Blocks |
|---|---|---|---|
| MQ1 | Source documents for the curves (turkey per sex, pullet growth, laying) and their licence (OQ5) | Import format only, no values | Standard comparisons for T51, T57, T61 |
| MQ2 | Moroccan egg grade limits and marking rules (law 49-99 art. 3-2°, 16) | Classes S/M/L/XL, limits null | Grade limits on P-EggStock |
| MQ3 | Vaccination protocols per species, reviewed by a vet (OQ4) | Empty templates, "not reviewed" | Default plans for new types |
| MQ4 | Egg withdrawal days per medicine and the egg-sale block rule (vet) | Required on each treatment of a layer batch; FIFO block | V6, H7 |
| MQ5 | Feed phases and transition ages per species | Farms name their own feed stock items | Feed-phase hints |
| MQ6 | Hatchery claim threshold for dead on arrival | Per farm, empty: no alert until set | B10 alert |
| MQ7 | Turkey: two batches per sex vs one batch with two pens | Two linked batches | — |
| MQ8 | Eggs per tray | 30 by default, editable on each sale line | — |
| MQ9 | Uniformity definition for pullets | ±10 % of the mean | B12 |
| MQ10 | Strains actually used in Morocco for turkeys, layers, ducks and quail | Only BUT 6 and Lohmann Brown (mockups) + "non précisée" per type | Strain lists |

## 6. Success criteria (M3 done)

1. A layer farm runs a pullet batch to transfer, then a layer batch with daily collections, grading, egg sales and an old-hen sale, offline, in Arabic and French (e2e).
2. A turkey placement by sex, a beldi run with two bands and a per-head sale work offline (e2e).
3. Every requirement above has a unit or integration test; `pnpm lint`, `pnpm typecheck`, `pnpm test` and the M3 Playwright specs pass.
4. The M1 broiler journey e2e still passes unchanged.
