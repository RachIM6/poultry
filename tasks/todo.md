# M1 task list: "Broiler core"

_Source: [plan.md](plan.md) · [SPEC.md](../SPEC.md). Requirement ids (I1, F2, B4…) refer to SPEC §8._

**Definition of done for every task:**
- `pnpm lint && pnpm typecheck && pnpm test` are green.
- New strings exist in `ar.json` and `fr.json`.
- New farm-data tables have `organizationId` and isolation tests.
- Edits and deletes write an audit event.

Abbreviations: **AC** = acceptance criteria, **e2e** = end-to-end test.

**File paths:**
- For **strict** modules (`flock`, `health`, `inventory`, `sales`), file names below map to `domain/` (pure rules such as `kpi.ts`, `withdrawal.ts`), `application/` (use cases) and `infrastructure/` (Prisma). See ADR-008 and the `poultry-ddd` skill.
- Auth tasks follow `poultry-auth`.

---

## Phase 1: Foundation

### T1: Scaffold app and tooling
**Description:** Create the Next.js (App Router, TypeScript strict) app with pnpm, Tailwind, ESLint, Vitest, Playwright and a GitHub Actions workflow running lint, typecheck and tests. Add the module folders and the ESLint `no-restricted-imports` boundary rule for the M1 modules.
**AC:**
- [x] `pnpm dev` serves a placeholder page. `pnpm build` succeeds. (Build + `pnpm start` verified by the Playwright smoke test.)
- [x] Importing `src/modules/sales/service.ts` from `src/modules/flock/` fails lint. Importing `src/modules/inventory/index.ts` from `flock` passes. (`eslint.boundaries.test.ts`)
- [x] CI runs lint + typecheck + unit tests on every push. (PR #2 `checks` job green.)

**Verify:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. CI is green on a branch.
**Dependencies:** none
**Files:** `package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`
**Size:** M

### T2: Database and integration-test harness
**Description:** Docker Compose Postgres, Prisma init, first models (`Organization`, `User`, `Membership`, `AuditEvent`), seed script stub, and a test helper that runs integration tests against a separate database that is reset per file.
**AC:**
- [x] `docker compose up -d db && pnpm db:migrate && pnpm db:seed` works on a clean machine. (Prisma 7.10.1 + pg adapter, Postgres 18 for `uuidv7()`.)
- [x] One `*.int.test.ts` creates and reads an organisation against the test database. (`src/lib/db.int.test.ts`; also asserts the per-file reset.)
- [x] CI runs the integration tests with a Postgres service. (PR #3: `poultry_test` created from scratch, `db.int.test.ts` passed.)

**Verify:** `pnpm test`. CI is green.
**Dependencies:** T1
**Files:** `docker-compose.yml`, `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/db.ts`, `src/test/db.ts`
**Size:** M

### T3: i18n Arabic/French with RTL shell
**Description:** next-intl with `/[locale]` routing, `ar` as default, `<html lang dir>`, a language switcher, and formatting helpers (money from centimes, grams → kg, farm day in `Africa/Casablanca`, Western digits). Add a CI check for missing keys.
**AC:**
- [x] `/ar` renders RTL and `/fr` renders LTR. The switcher keeps the current page. (`e2e/smoke.spec.ts`, plus a manual check at 375 px.)
- [x] `formatMoney(123450n)` → `1 234,50 DH` in both locales, with Western digits. `farmDay()` returns the right date around the Ramadan time change. Both are covered by unit tests. (`src/lib/format.test.ts`; `farmDayOf` lives in `src/lib/kernel/farm-day.ts`.)
- [x] CI fails when a key is missing in one locale. (A unit test, `src/i18n/messages.test.ts`, instead of a separate script, so the existing `pnpm test` step enforces it.)

**Verify:** `pnpm test -- src/lib/format`. Manual check of both locales on a mobile viewport.
**Dependencies:** T1
**Files:** `src/i18n/*`, `src/app/[locale]/layout.tsx`, `messages/ar.json`, `messages/fr.json`, `src/lib/format.ts`, `scripts/check-messages.ts`
**Size:** M

### T4: PWA shell
**Description:** Web manifest (AR/FR name, icons), Serwist service worker precaching the app shell, offline fallback page, in-app "install the app" guide (Android and iOS steps), and a `navigator.storage.persist()` request.
**AC:**
- [ ] Lighthouse reports the app as installable. After the first visit, the shell loads with the network off.
- [ ] The install guide shows the right steps for Android Chrome and for iOS Safari.

**Verify:** `pnpm build && pnpm start`. Lighthouse PWA audit. Playwright test: offline reload shows the shell.
**Dependencies:** T1, T3
**Files:** `src/app/manifest.ts`, `src/sw.ts`, `next.config.ts`, `src/app/[locale]/install/page.tsx`, `public/icons/*`
**Size:** M

### ✅ Checkpoint A
- [ ] The app builds, installs on an Android phone and switches AR ↔ FR. CI is green.
- [ ] Human review before Phase 2.

---

## Phase 2: Identity & tenancy

### T5: Phone OTP login and sessions (I1, I2)
**Description:** Evaluate the auth library (Better Auth phone-OTP vs. a minimal in-house version on the same `Session` table) and record the outcome in ADR-005. Then implement login with a Moroccan number, a hashed 6-digit code, the limits from SPEC I1, 30-day database sessions in secure cookies, logout, and a dev OTP sink that prints to the console.
**AC:**
- [ ] Login works end to end in dev. A wrong code 5 times locks the code. The 4th request within 15 min is refused.
- [ ] The session cookie is `httpOnly; Secure; SameSite=Lax`. Logout invalidates the session on the server.
- [ ] ADR-005 is updated to Accepted, with the library decision.

**Verify:** integration tests for every OTP rule. Playwright e2e login on a mobile viewport.
**Dependencies:** T2, T3
**Files:** `src/modules/identity/*`, `src/app/api/auth/*`, `src/app/[locale]/login/page.tsx`, `prisma/schema.prisma`, ADR-005
**Size:** M

### T6: Onboarding, legal entity and tenant context (I3, F1)
**Description:** First login → create the organisation and its legal entity (form → accounting profile), and save the language on the user. Build `getTenantContext()` and `can(ctx, action, resource)`, plus a reusable isolation test pattern.
**AC:**
- [ ] A new user completes onboarding in AR or FR and lands on an empty dashboard.
- [ ] Every repository function requires a `ctx`. A test shows that user A gets 404 on organisation B's legal entity.
- [ ] The accounting profile is derived correctly for all 6 legal forms (unit test).

**Verify:** `pnpm test -- src/modules/farm-registry src/lib/tenant`. e2e onboarding.
**Dependencies:** T5
**Files:** `src/lib/tenant.ts`, `src/lib/permissions.ts`, `src/modules/farm-registry/*`, `src/app/[locale]/onboarding/*`, `prisma/schema.prisma`
**Size:** M

### T7: Members, roles and field visibility (I4, I5)
**Description:** The owner invites members by phone with a role (owner / manager / worker), lists them, changes their role, and removes them (which revokes their sessions). Add a role → action table and server-side stripping of money fields for workers.
**AC:**
- [ ] An invited number logs in and joins the organisation with the right role.
- [ ] A worker's API responses contain **no** price, cost, amount or credit fields. This is checked by tests on the serializers.
- [ ] Removing a member logs out all their devices at their next online request.

**Verify:** integration tests per role. Manual check with two browsers.
**Dependencies:** T6
**Files:** `src/modules/identity/members.ts`, `src/lib/permissions.ts`, `src/app/[locale]/settings/members/*`
**Size:** M

### ✅ Checkpoint B
- [ ] Isolation and role tests pass. Two organisations cannot see each other's data. A worker cannot see money.
- [ ] Human review.

---

## Phase 3: Offline sync

### T8: Sync server: idempotent push and versioned pull (X1–X3)
**Description:** Implement the server side of ADR-003:
- a `Mutation` log table, unique on the mutation id;
- a per-organisation `version` counter and tombstones;
- `POST /api/sync/push`: validates with module Zod schemas, applies each mutation in a transaction with an audit event, returns a result per mutation;
- `GET /api/sync/pull?since=`.

A test-only entity can be used until T10.
**AC:**
- [ ] Pushing the same mutation twice applies it once and returns the same result.
- [ ] Pull returns exactly the rows changed after the cursor, including deletions, and only for the caller's organisation.
- [ ] An invalid or forbidden mutation returns `rejected` with a `messageKey`. Valid mutations in the same batch still apply.

**Verify:** `pnpm test -- src/app/api/sync src/lib/sync` (integration).
**Dependencies:** T6
**Files:** `src/lib/sync/server.ts`, `src/app/api/sync/push/route.ts`, `src/app/api/sync/pull/route.ts`, `prisma/schema.prisma`
**Size:** M

### T9: Sync client: Dexie, outbox, status (X1)
**Description:** Dexie database, generic local write → outbox, sync loop (start, `online` event, after a write, every 60 s, Background Sync on Android), pull merge, a sync status badge (pending count, last sync) and a "needs attention" list for rejected mutations.
**AC:**
- [ ] Offline writes survive a reload and appear in the pending count.
- [ ] Back online, the outbox empties and the pending count goes back to 0.
- [ ] A rejected mutation appears in "needs attention" with a translated message.

**Verify:** unit tests for the outbox and merge logic (fake IndexedDB). Playwright offline → reload → online scenario.
**Dependencies:** T4, T8
**Files:** `src/offline/db.ts`, `src/offline/outbox.ts`, `src/offline/sync.ts`, `src/components/sync-status.tsx`, `src/sw.ts`
**Size:** M

### T10: Farms and houses offline (F2, F3, F4)
**Description:** The first real vertical slice through sync: create and edit farms (region, province, commune, GPS, ONSSA authorization + expiry) and houses (area, capacity, type) offline.
**AC:**
- [ ] A farm and 2 houses created offline are visible after a reload, then sync. A second device sees them after pull.
- [ ] Concurrent edits of the same farm field converge to the last value received. The overwritten value is in the audit log.

**Verify:** e2e: two browser contexts, one offline. Integration test for the merge.
**Dependencies:** T9
**Files:** `src/modules/farm-registry/{schema,service,index}.ts`, `src/app/[locale]/farms/*`, `prisma/schema.prisma`
**Size:** M

### ✅ Checkpoint C (high risk)
- [ ] Real Android phone + installed iPhone: offline for a day, edit, reload, go online, converge. No loss, no duplicates.
- [ ] **ADR-003 set to Accepted, or revised.**
- [ ] Human review.

---

## Phase 4: Reference data, notifications, stock

### T11: Reference data (R1–R4)
**Description:**
- Seed broiler strains Ross 308 and Cobb 500 with daily standard weight and cumulative feed, with source and version stored per curve (OQ5).
- Seed the default vaccination protocol template (flagged "to be reviewed by vet").
- Seed the product catalogue: feed phases, vaccines, medicines with meat withdrawal days.
- Make all of it versioned and pullable for offline use.

**AC:**
- [ ] Reference data is available offline after the first sync.
- [ ] Day 35 standard weight for each strain matches the source document. This is a manual spot check of 5 values per strain.
- [ ] Farms can copy and edit the protocol. The global template stays read-only.

**Verify:** `pnpm db:seed`. Unit test on curve lookup (interpolation between days). Manual spot check.
**Dependencies:** T10
**Files:** `src/modules/reference-data/*`, `prisma/seed/reference/*.json`, `prisma/schema.prisma`
**Size:** M

### T12: Notifications (N1–N3)
**Description:** In-app inbox, web push subscription (VAPID), `notify(userIds, templateKey, params, urgency)`, AR/FR templates, quiet hours per user.
**AC:**
- [ ] A test notification reaches the inbox and, on Android, a push.
- [ ] During quiet hours, non-urgent notifications are held and delivered at the end. Urgent ones go through immediately (unit test on the scheduling rule).

**Verify:** `pnpm test -- src/modules/notifications`. Manual push on a real Android phone and on an installed iPhone.
**Dependencies:** T10
**Files:** `src/modules/notifications/*`, `src/app/api/push/*`, `src/sw.ts`, `src/app/[locale]/inbox/*`
**Size:** M

### T13: Stock ledger, purchases, supplier credit (S1–S3)
**Description:** Stock items per farm (linked to catalogue products, with lot and expiry for vaccines and medicines), suppliers, purchases as `purchase` movements with amount paid and credit due date, supplier balances, stock on hand = sum of movements. All offline.
**AC:**
- [ ] A purchase made offline increases stock after sync. The unpaid part shows in the supplier balance.
- [ ] Stock on hand is never stored as an editable number. An adjustment is a movement with a reason.
- [ ] A worker sees quantities but not prices or balances.

**Verify:** unit tests for the balance and stock computation. Integration tests for isolation and roles.
**Dependencies:** T11, T7
**Files:** `src/modules/inventory/*`, `src/app/[locale]/stock/*`, `prisma/schema.prisma`
**Size:** M

### T14: Stock valuation and low-stock alerts (S5, S6)
**Description:** Weighted-average cost per item and farm, applied to consumption movements. Low-stock threshold per item triggers a notification.
**AC:**
- [ ] The valuation matches a hand-computed example of 3 purchases at different prices and 2 consumptions (unit test).
- [ ] Crossing the threshold sends one notification, not one per movement.

**Verify:** `pnpm test -- src/modules/inventory`
**Dependencies:** T12, T13
**Files:** `src/modules/inventory/valuation.ts`, `src/modules/inventory/alerts.ts`
**Size:** S

### ✅ Checkpoint D
- [ ] Reference data offline, push works on real devices, stock and supplier credit correct.
- [ ] Human review.

---

## Phase 5: Flock

### T15: Create batch, placement (B1)
**Description:** Create a broiler batch in a house: strain, placement date, chicks placed, hatchery, delivery note n°, chick unit price, day-old weight, dead on arrival. One open batch per house: checked on the client, enforced on the server as a rejected mutation.
**AC:**
- [ ] Creating a batch offline works. Its age counts from the placement farm day.
- [ ] A second open batch in the same house is rejected with a clear message, including when two devices create one offline at the same time.

**Verify:** unit test on age computation. Integration test on the uniqueness conflict. e2e create flow.
**Dependencies:** T11, T10
**Files:** `src/modules/flock/{schema,service,index}.ts`, `src/app/[locale]/batches/new/*`, `prisma/schema.prisma`
**Size:** M

### T16: Daily entry with automatic feed consumption (B2, S4)
**Description:** One entry per batch per farm day: mortality + cause, culls, feed (item + kg), water, note. It creates the feed consumption movement automatically. Edits are allowed until closing and are audited. Same-day entries from two devices are merged.
**AC:**
- [ ] A trained user completes an entry in **under 60 s** on a phone. Timed manually with 3 testers.
- [ ] Saving feed creates exactly one consumption movement. Editing the kg updates that movement, never a duplicate.
- [ ] Two offline entries for the same day merge into one after sync (integration test).

**Verify:** unit tests for the merge. Integration tests. e2e daily-entry flow in AR and FR.
**Dependencies:** T15, T14
**Files:** `src/modules/flock/daily-entry.ts`, `src/app/[locale]/batches/[id]/today/*`, `prisma/schema.prisma`
**Size:** M

### T17: Weighings and uniformity (B3)
**Description:** Record a sample, as individual weights or as total ÷ count. Compute average and CV% (CV only with individual weights). Compare with the strain standard for that age.
**AC:**
- [ ] Average and CV% match a hand-computed sample (unit test).
- [ ] The screen shows "x % vs standard" for that age, from the reference curve.

**Verify:** `pnpm test -- src/modules/flock/weighing`
**Dependencies:** T15, T11
**Files:** `src/modules/flock/weighing.ts`, `src/app/[locale]/batches/[id]/weighing/*`
**Size:** S

### T18: KPI engine and batch dashboard (B4)
**Description:** Pure KPI functions (age, birds on hand, mortality %, feed per bird, FCR, EPEF, average daily gain) and the batch dashboard with a growth chart vs the standard. They run on the client from local data.
**AC:**
- [ ] Each KPI matches a hand-calculated reference batch (fixture) on days 7, 21 and 35. Every branch is covered (zero birds, no weighing yet…).
- [ ] The dashboard works offline and updates right after a daily entry.

**Verify:** `pnpm test -- src/modules/flock/kpi`. e2e: dashboard after 3 entries.
**Dependencies:** T16, T17
**Files:** `src/modules/flock/kpi.ts`, `src/modules/flock/kpi.test.ts`, `src/app/[locale]/batches/[id]/page.tsx`
**Size:** M

### ✅ Checkpoint E
- [ ] 10 simulated days of a batch, offline, with KPIs equal to the hand calculation (fixture).
- [ ] Human review.

---

## Phase 6: Health

### T19: Vaccination plan, reminders, mark as done (H1, H2)
**Description:** Generate the plan from the farm protocol when a batch is created. Send reminders the day before and on the due day. "Mark done" records the date, the lot (picked from stock, which deducts it), the method and who did it.
**AC:**
- [ ] A new batch gets the expected items with their due dates (unit test against the protocol fixture).
- [ ] Marking a vaccine done deducts the vaccine lot from stock.
- [ ] Reminders arrive at the right times and respect quiet hours.

**Verify:** `pnpm test -- src/modules/health`. Manual check of reminder delivery.
**Dependencies:** T18, T12
**Files:** `src/modules/health/{vaccination,schema,service,index}.ts`, `src/app/[locale]/batches/[id]/health/*`
**Size:** M

### T20: Treatments, withdrawal, vet visits (H3–H6)
**Description:** Record treatments (product, dose, start / end, reason, prescriber), compute the withdrawal end date, show the banner on the batch, and keep a vet visit log. Data is stored in the form needed for the M2 ONSSA register.
**AC:**
- [ ] Withdrawal end = end date + withdrawal days, using farm days and the longest of overlapping treatments (unit tests).
- [ ] The banner shows until the withdrawal end date, then disappears.

**Verify:** `pnpm test -- src/modules/health/withdrawal`. e2e banner.
**Dependencies:** T19
**Files:** `src/modules/health/{treatment,withdrawal}.ts`, `src/app/[locale]/batches/[id]/health/*`
**Size:** M

### ✅ Checkpoint F
- [ ] A vet reviews the default protocol and the withdrawal behaviour (OQ4). Corrections are applied.
- [ ] Human review.

---

## Phase 7: Sales & closing

### T21: Buyers and live-bird sales (V1–V3, B5)
**Description:** Buyers, and live-bird sales with:
- farm and buyer weights (weighing gap), price per kg, payment method, cheque / bill details;
- thinning, which lowers birds on hand;
- a **hard block while a withdrawal period is running**, checked on the client and on the server.

**AC:**
- [ ] A sale during withdrawal is refused with a translated explanation. This includes a sale created offline and pushed later.
- [ ] Amount = weight × price/kg, in integer centimes. The weighing gap is shown in kg and %.
- [ ] Partial sales reduce birds on hand and keep the batch open.

**Verify:** unit tests on amounts and the gap. Integration test for the server-side block. e2e sale flow.
**Dependencies:** T20, T18
**Files:** `src/modules/sales/*`, `src/app/[locale]/sales/*`, `prisma/schema.prisma`
**Size:** M

### T22: Receivables and due-date reminders (V4)
**Description:** List unpaid amounts per buyer with due dates. Record later payments. Remind on cheque and bill due dates.
**AC:**
- [ ] The balance per buyer equals sales − payments (unit test).
- [ ] A reminder is sent on the due date of each cheque or bill.

**Verify:** `pnpm test -- src/modules/sales/receivables`
**Dependencies:** T21, T12
**Files:** `src/modules/sales/receivables.ts`, `src/app/[locale]/sales/receivables/*`
**Size:** S

### T23: Printable origin document (V5)
**Description:** A printable page per sale, in AR or FR: farm identity and ONSSA authorization, batch, birds, weight, date, buyer, signature box. It uses print CSS, with no PDF library in M1.
**AC:**
- [ ] It prints on A4 in both locales with no layout break, RTL included.
- [ ] It contains every field listed in this task's description.

**Verify:** manual print preview in AR and FR. Snapshot test of the content.
**Dependencies:** T21
**Files:** `src/app/[locale]/sales/[id]/origin/page.tsx`, `src/styles/print.css`
**Size:** S

### T24: Batch closing and cost per kg (B6)
**Description:** Automatic close when birds on hand reach 0, or manual close with a reason. Lock the final KPIs. Cost per kg sold = (chicks + valued consumptions + other batch costs) ÷ kg sold. Add a simple "other cost" entry on the batch (electricity, labour…) until finance arrives in M2.
**AC:**
- [ ] The last sale closes the batch automatically. Afterwards, entries are read-only.
- [ ] Cost per kg matches the reference fixture (unit test).
- [ ] The house becomes free for a new batch.

**Verify:** `pnpm test -- src/modules/flock/closing`. e2e full lifecycle.
**Dependencies:** T21, T14
**Files:** `src/modules/flock/closing.ts`, `src/app/[locale]/batches/[id]/close/*`
**Size:** M

### ✅ Checkpoint G
- [ ] Full M1 e2e passes in `ar` and `fr` on a mobile viewport, with an offline segment (SPEC §9.2).
- [ ] Human review.

---

## Phase 8: Pilot readiness

### T25: Security review and performance budget
**Description:**
- Run the `security-and-hardening` review: OTP, sessions, tenant isolation, input validation, dependency audit. Fix the high findings.
- Measure the JS budget (≤ 200 KB compressed for the shell) and the daily-entry interactivity (< 3 s with Fast 4G) on a real mid-range Android phone.

**AC:**
- [ ] No open high-severity security findings.
- [ ] Both performance budgets are met, or a written exception has been approved.

**Verify:** review report in `docs/`. `pnpm build` output. Lighthouse report.
**Dependencies:** Checkpoint G
**Files:** depends on findings
**Size:** M

### T26: Pilot deployment
**Description:** Deploy staging and pilot environments with the hosting chosen in OQ1 (ADR-007 superseded). Plug in the production OTP provider (OQ2), set up backups, add a demo-farm seed, and write a one-page quick guide in AR and FR.
**AC:**
- [ ] The pilot farm owner and a worker log in on their own phones and complete the first daily entry.
- [ ] A daily backup runs and has been restored once as a test.

**Verify:** smoke test on production. Backup restore drill.
**Dependencies:** T25, **OQ1, OQ2 resolved**
**Files:** deployment config (depends on the host), `docs/quick-guide-ar.md`, `docs/quick-guide-fr.md`
**Size:** M

### ✅ Checkpoint M1
- [ ] SPEC §9 success criteria 1–5 are met.
- [ ] Retrospective, then plan M2.
