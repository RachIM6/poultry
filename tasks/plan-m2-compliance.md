# Implementation plan: M2 compliance (biosecurity, documents, reporting)

_v0.1, 16 Nov 2026. Status: **draft**. Implements [SPEC-m2-compliance.md](../SPEC-m2-compliance.md). The finance half of M2 is [plan-m2-finance.md](plan-m2-finance.md) (T27–T39). Tasks here are **T40–T49**; T50+ belongs to M3._

Definition of done, file layout and verification commands are the same as [todo.md](todo.md): `pnpm lint && pnpm typecheck && pnpm test`, plus the task's Playwright spec. Order inside a task: domain unit test → integration test (tenant isolation, idempotency) → page → e2e. One branch per task, `feat/t<N>-<slug>`, each stacked on the previous one; the first one's base is `feat/t38-export`.

## Architecture decisions

Taken as safe defaults (SPEC-m2-compliance §3, to report to the owner):
- **PDF through print CSS**, no PDF library (as T23's origin document).
- **The register is built on the phone** from synced records, in a precached static shell: it prints offline, on the farm.
- **Files in PostgreSQL** (`StoredFile`, bytea, ≤ 5 MB, PDF/JPEG/PNG/WebP by magic bytes), one upload route handler: ADR-011.
- **Biosecurity records are offline mutations**; a proof photo is attached online, later, to the same record. The sync protocol doesn't change.
- **No official content invented**: register layout, disposal methods, minimum downtime, retention and the inspection checklist wait for CQ1–CQ7; printed pages carry « Présentation provisoire, à valider avec l'ONSSA ».

## Dependency graph

```
T40 visitor log (biosecurity foundation) ── T41 disposal + manure ── T42 clean-out + downtime
T43 file storage + rodent proof (documents foundation; uses T40's module) ── T44 vault ── T45 expiry alerts
T46 register builder (reporting foundation, uses T41 disposals) ── T47 register PDF
T46 + finance T34 ── T48 batch report
T42 + T43 + T44 + T47 ── T49 inspection pack
```

## Tasks

### T40: Visitor log (BS1–BS3, BS9)
**Description:** Create the `biosecurity` module (light): `Visit` table, `biosecurity.record` permission, `biosecurity.recordVisit` offline mutation, `visit` entity in pull, pure `visitZone` rule, static shell `/visitors` (form + today's visits).
**AC:**
- [x] `visitZone`: a visitor from another farm within `VISITOR_RECENT_FARM_HOURS` gets the dirty zone only; the clean zone is refused on the phone and on the server (`VISIT_DIRTY_ZONE_ONLY`). (`biosecurity/domain/visit.test.ts`, `visits.int.test.ts`.)
- [x] A visit recorded offline reaches the server once after sync; another organisation can't read or write it (integration test). (`biosecurity/visits.int.test.ts`: twice the same mutation, then the same id again → `ALREADY_EXISTS`; workers allowed.)
- [x] e2e: a visit recorded offline, reloaded from the service worker, synced once (`e2e/visitors.spec.ts`).

Done 2026-11-16 (branch `feat/t40-visitors`):
- `biosecurity` is light: `service.ts` holds the sync handlers, `domain/visit.ts` the zone rule the phone and the server share.
- The visit's time is the phone's clock at saving (`enteredAt`); "today" is the farm day of that instant.
- `/visitors` is a precached static shell, linked from the dashboard for every role.
**Files:** `prisma/schema.prisma` + migration, `src/modules/biosecurity/{shared,schema,service,index}.ts`, `src/lib/permissions.ts`, `src/app/api/sync/registry.ts`, `src/app/[locale]/visitors/page.tsx`, `src/components/visitors.tsx`, `messages/*.json`, `e2e/visitors.spec.ts`
**Size:** M

### T41: Dead-bird disposal and manure (BS6, BS7)
**Description:** `Disposal` and `ManureRemoval` tables and mutations; static shell `/disposal` with two tabs (dead birds, manure) and, per batch, the daily mortality next to the birds disposed (`disposalGap`).
**AC:**
- [x] Methods are `incineration`, `authorizedSite`, `other` + description (CQ4); `other` without a description is refused. (`domain/disposal.test.ts`, `disposals.int.test.ts`.)
- [x] `disposalGap` per day = dead + culls of the daily entry − birds disposed. (`disposalGaps`, per farm day across the farm's batches.)
- [x] e2e: a disposal and a manure removal recorded offline sync once (`e2e/disposal.spec.ts`, with the gap going from 6 to 0).

Done 2026-11-16 (branch `feat/t41-disposal`):
- The comparison is **per farm day**, all the farm's batches together: a disposal often covers several houses. It looks back 14 days on the phone (a screen choice).
- A disposal or removal may name a batch (and a house for manure); the server checks they are on the farm given.
- `/disposal` is a precached static shell with two tabs; the "Nuisibles" tab comes with T43.
**Size:** M

### T42: Clean-out and downtime (BS4, BS5)
**Description:** `Cleanout` (house, batch it follows) and its steps as `CleanoutStep` rows (step key, farm day, fields); mutations `startCleanout`, `recordCleanoutStep`; `Farm.minDowntimeDays` (optional, `farms.manage`); `downtimeDay` and `downtimeWarning`; static shell `/cleanout`; the placement form warns when the house's downtime is below the farm's minimum.
**AC:**
- [x] Each step once per clean-out (`STEP_ALREADY_DONE`); a clean-out only for a house whose last batch is closed (`BATCH_NOT_CLOSED`), once per batch (`CLEANOUT_ALREADY_STARTED`). (`cleanouts.int.test.ts`.)
- [x] Fixtures: disinfected 5 Nov, today 6 Nov → day 2; minimum 14, placement 17 Nov → warning, 19 Nov → none. (`domain/cleanout.test.ts`.)
- [x] e2e: steps marked offline; the placement warning shows (`e2e/cleanout.spec.ts`).

Done 2026-11-16 (branch `feat/t42-cleanout`), decisions taken without asking:
- **The farm's minimum is biosecurity's own record** (`DowntimeSetting`, keyed by farm), not a `Farm` column: `farm-registry`'s schemas and every createFarm payload stay as they are. Set by owners and managers (`farms.manage`); no default (CQ3).
- **The clean-out is one record on the phone** with its steps inside; on the server, steps are rows (`CleanoutStep`, unique per step), each audited.
- **Disinfection needs a product** (SCOPE §4: product, dose, date); dose and product lot are optional.
- The placement form shows the warning live, from the house's last closed batch's clean-out; the placement still goes through.
- `/cleanout` is a precached static shell; the rodent-control step's proof photo comes with T43.
**Size:** M

### T43: File storage and rodent control with proof (DC2, BS8, ADR-011)
**Description:** Create the `documents` module with `StoredFile`; `POST /api/files` and `GET /api/files/[id]`; `RodentCheck` in `biosecurity` with `proofFileId`; the "Nuisibles" tab on `/disposal`; "Ajouter la photo" when online.
**AC:**
- [x] Upload refuses a wrong type (magic bytes), > 5 MB, no session, wrong origin; download is tenant-scoped, `Content-Disposition: attachment`, `nosniff`. (`documents/domain/file.test.ts`, `app/api/files/files.int.test.ts`.)
- [x] A rodent check is recorded offline; its photo is attached online once (`PROOF_ALREADY_ATTACHED`); without one it shows "preuve à ajouter".
- [x] e2e: record a check, attach a photo, the proof link downloads it (`e2e/rodents.spec.ts`).

Done 2026-11-16 (branch `feat/t43-files`), decisions taken without asking (ADR-011, proposed):
- **The file is the request body**, not multipart, so the 5 MB cap applies while reading. Rate limit `fileUpload`: 30 per user per hour.
- **The upload route attaches the proof itself** (`?purpose=proof&rodentCheck=<id>`): a check only points at a file its organisation just uploaded, and `biosecurity` doesn't import `documents` (the capability map is unchanged).
- **The photo button shows once the check is on the server** (no unsent write for it) and the phone is online; until then "Preuve à ajouter".
- Permission `documents.manage` (owner, manager) is for the vault; proofs follow `biosecurity.record`.
- The rodent-control step of a clean-out (T42) and a rodent check are separate records; the inspection pack (T49) shows both.
**Size:** M

### T44: Document vault (DC1, DC3)
**Description:** `Document` table, `documents.manage` (owner, manager), online page `/documents` (list by expiry with state, add or edit with an optional file), `documentState`.
**AC:**
- [x] Fixture: expiry 30 Nov 2026, today 5 Nov, soon = 60 → `soon`; 15 Mar 2027 → `valid`; 1 Nov → `expired`. (`documents/domain/document.test.ts`.)
- [x] A worker can't open `/documents`, upload, or download a vault file (integration test). (`documents.int.test.ts`, `app/api/files/files.int.test.ts`.)
- [x] e2e: add an insurance policy with a PDF; it shows as "à renouveler bientôt" with the file link (`e2e/documents.spec.ts`).

Done 2026-11-16 (branch `feat/t44-vault`), decisions taken without asking:
- **The vault is offline like the logs**, not an online page: documents are synced records (owners and managers only, never pulled by workers), so the inspection pack and the register can read them on the phone. The scan is attached online by the upload route (`?purpose=document&document=<id>`), once, like the rodent proof.
- **Attach is a conditional update** (security review): of two uploads at once, only the first attaches. Same fix for the rodent proof.
- **No edit screen yet**: `documents.updateDocument` exists (field by field, audited); a renewal is a new document.
- Shared screen helpers (`local-screen.tsx`: static shell, field, file upload) now serve the logs and the vault.
**Size:** M

### T45: Expiry alerts (DC4)
**Description:** `sendDocumentReminders` in `documents`, called by the dispatch route next to the vaccination and instrument reminders; templates `documentExpiring`, `documentExpired`; the farm's ONSSA authorization (F2) included.
**AC:**
- [x] Owners and managers are notified once at `DOCUMENT_SOON_DAYS` before and once on the expiry day; a second run the same day sends nothing; workers get nothing. (`documents/reminders.int.test.ts`.)
- [x] A farm's ONSSA authorization expiring gets the same two alerts.

Done 2026-11-16 (branch `feat/t45-expiry-alerts`), decisions taken without asking:
- **"Soon" means from the day a document is within 60 days**, not only on day 60 exactly: a document added with 30 days left, or a scheduler that missed a day, still gets its reminder. "Expired" goes from the expiry day on.
- **Once** = a claim row per (subject, expiry date, kind) in `DocumentReminder`; a renewed date is announced again.
- Dates in the texts are `dd/mm/yyyy`, the same in both languages. No e2e: no screen; the inbox already renders any template (T12).
**Size:** S

### T46: Register builder (RP1)
**Description:** Create the `reporting` module with the pure `buildRegister(input)` over the synced DTOs (batch, farm, house, daily entries, vaccinations, treatments, vet visits, sold birds and sales, disposals, lab-report documents when visible).
**AC:**
- [x] B-2026-13 fixtures: 26 Oct birds on hand 9 620 with 4 dead; enrofloxacine 22–26 Oct + 5 days → withdrawal end 31 Oct. (`reporting/domain/register.test.ts`.)
- [x] Every RP1 section is present; no money field reaches the output (unit test on a worker's input).

Done 2026-11-16 (branch `feat/t46-register-builder`), decisions taken without asking:
- **Ages follow the app's own rule** (`flock.ageOn`, placement day = day 0): 26 Oct is day 35 here, where the canvas wrote "J36". Which convention ONSSA's register uses is part of CQ1.
- **Birds on hand** are after the day's deaths, culls and birds sold; a day "under withdrawal" runs from a treatment's start to its withdrawal end.
- **Lab reports** are vault documents of category `labReport` for the batch's farm (or the whole organisation) issued between placement and closing; owners' and managers' phones have them, workers' don't.
- `sales.originNumber` is now the one place the origin document's number is made (the origin page uses it too).
**Size:** S

### T47: Register PDF (RP2)
**Description:** Static shell `/register#<batch id>`, precached, printing `buildRegister` in A4 with print CSS, in AR or FR, with the provisional ONSSA mention and signature boxes; a "Registre" link from the batch screen.
**AC:**
- [ ] e2e in `fr` and `ar`: offline, the register of a demo batch shows its cover, daily rows, vaccinations, treatments, birds out and disposals.
- [ ] Print CSS: only the document prints (no header or buttons).
**Size:** M

### T48: Batch report (RP3)
**Description:** Online page `/report?batch=<id>` (owner, manager), printable; `buildBatchReport` (pure) from flock KPIs and standard, health summary, sales, finance's batch result, and the farm's previous closed batches.
**AC:**
- [ ] The report's margin and cost per kg equal `/results` for the same batch (integration test).
- [ ] Comparison rows: previous closed batches of the farm, newest first.
- [ ] A worker gets a refusal page, never money (integration test); e2e opens a closed demo batch's report.
**Size:** M

### T49: Inspection pack (RP4)
**Description:** Online page `/inspection?farm=<id>` (owner, manager) that prints in one document: authorization, vault documents and state, registers of open and recently closed batches (`INSPECTION_LOOKBACK_MONTHS`), clean-outs, visitors, disposals, manure, rodent checks; missing pieces listed as missing.
**AC:**
- [ ] The checklist marks missing pieces (no authorization, an expired document, a rodent check without proof).
- [ ] Another organisation's farm id gives "not found" (integration test); e2e prints a demo farm's pack.
**Size:** M

### ✅ Checkpoint M2-compliance
- [ ] CQ1: the owner has provided the official register template, and RP1–RP2 follow it; the provisional mention is removed.
- [ ] A private vet or ONSSA contact has reviewed the register, the disposal methods (CQ4) and the inspection checklist (CQ2).
- [ ] SPEC-m2-compliance §10 criteria met.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The official register layout differs a lot from the provisional one | Medium: T47 rework | `buildRegister` keeps data and layout apart; only the page changes |
| Files in Postgres grow the database | Low at pilot scale | 5 MB cap; ADR-011 revisits with hosting (OQ1) |
| The UI restyle session lands its design system mid-way | Low | Simple Tailwind screens; rebase onto `feat/u1-design-system` when its PR appears |
| The phone's local data grows with years of records | Low in M2 | The register reads one batch; pruning is a sync concern for later |
