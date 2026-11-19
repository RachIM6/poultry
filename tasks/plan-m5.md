# Implementation plan: M5 network

_v0.1, 18 Nov 2026. Status: **draft**, written while the owner was away. Implements [SPEC-m5.md](../SPEC-m5.md) (`partner-access`, `market-prices`, `planning`) and [ADR-013](../docs/decisions/ADR-013-partner-access.md). Task numbers T90–T99 (T70–T89 are M4)._

Definition of done, layout and verification as in [plan-m4.md](plan-m4.md): domain test → integration test (tenant isolation, idempotency, role stripping) → screen → Playwright spec, then lint, typecheck, `pnpm test`, the spec and `e2e/budget.spec.ts`. Branches `feat/t<N>-<slug>`, each stacked on the previous one, the first on `docs/m5-plan`, itself on `test/checkpoint-e` (#105). Databases `poultry_m4` / `poultry_test_m4`, Playwright on `E2E_PORT=3500`. New modules start **light**. New screens are static shells, precached, linked from "Plus"; nothing new on `/batches`.

## Dependency graph

```
T90 roles + access end ── T91 pull allowlist ── T92 organisation switcher ── T93 partners on the members screen
T94 price log ── T95 /prices
T96 planned batches ── T97 /planning + warnings ── T98 place from plan ── T99 reminder
```

## Tasks

### T90: Vet and accountant roles, access end date (PA1, PA3, §5)
**Description:** `MemberRole` and `Role` gain `vet`, `accountant`; `Invitation` and `Membership` gain `accessUntil`; the invitation form offers the two roles and the date (owner only). `getTenantContext` ignores a membership past its end. The role → action table gets the rows of SPEC-m5 §5.
**AC:**
- [x] An owner invites a vet with an end date; a manager cannot invite one (integration). (`identity/partners.int.test.ts`; `e2e/partners.spec.ts`)
- [x] A membership past `accessUntil` gives `NO_MEMBERSHIP` for that organisation (integration). (On the end day itself it still opens.)
- [x] Vet: `health.record` yes, `flock.manage`, `money.read`, `workforce.manage` no; accountant: `money.read` yes, every write no (unit on `can`). (`lib/permissions.test.ts` lists every action each partner gets.)

Done 2026-11-18 (branch `feat/t90-partner-roles`), decisions taken without asking:
- **The end day is a farm day, included:** the membership opens the organisation up to and on that day. Only partners may have one; staff are ended by removing them, and a partner whose role is changed to staff loses theirs.
- **An end day in the past is refused** at invitation.
- **Not yet:** a vet who already belongs to another farm stays with their pending invitation until T92 (the accept screen and the switcher). Until T91, a partner's phone pulls what a worker's would, money included for the accountant.
**Size:** M

### T91: Partner pull allowlist (PA4, PA5, ADR-013)
**Description:** the sync pull skips, for a vet or an accountant, every entity not on that role's list; the lists live with the registry.
**AC:**
- [x] A vet pulls batches, entries and health, and no sale, purchase, expense, employee, staff record, advance or price (integration on the full registry: the test fails when a new entity is added without a decision). (`app/api/sync/partners.int.test.ts`)
- [x] An accountant pulls money and batches, and no staff record or climate target set.

Done 2026-11-18 (branch `feat/t91-partner-pull`), decisions taken without asking:
- **`SyncRegistry.views`:** per partner role, the entities that may leave; the pull skips the rest. Staff roles have no view and keep the serializers' rules. The lists live in `app/api/sync/registry.ts` (server only: nothing added to the phone's JS).
- **Vet:** farms, houses, batches (money stripped), daily entries, weighings, birds sold (counts), protocols, vaccinations, treatments, vet visits, stock items and movements (vaccine lots, no prices), their own notifications. Not climate: SPEC-m5 PA4 keeps the vet to batches and health.
- **Accountant:** everything with money (purchases, suppliers, stock, sales, buyers, payments, instruments, treasury, expenses, transfers, batch costs, employees, advances, pay, labour rules), farms, houses, batches, birds sold, their own notifications. Not daily entries, weighings, health, tasks, attendance, staff records or climate.
- **Finance reads moved from `finance.record` to `money.read`** (the books, the export, treasury, results, budgets list, threshold, and the synced treasury, expenses and transfers): the same owners and managers as before, plus the accountant. Writes keep `finance.record`. The "Plus" menu shows the accountant every finance screen except expenses.
**Size:** M

### T92: Active organisation (PA2)
**Description:** a cookie with the chosen organisation, checked against the user's live memberships on every request; `/organizations` to open a farm or accept a waiting invitation; "Changer d’exploitation" in "Plus".
**AC:**
- [x] A user with two memberships switches; each organisation's data stays in its own phone database (Playwright). (`e2e/switch-farm.spec.ts`)
- [x] A forged cookie or someone else's organisation falls back to the oldest live membership (integration). (`identity/organizations.int.test.ts`)

Done 2026-11-18 (branch `feat/t92-switch-farm`), decisions taken without asking:
- **Cookie `__Host-org`, not signed:** httpOnly, Secure, SameSite=Lax, one year. It is only a hint: `getTenantContext` opens it only when it is one of the user's live memberships, else the oldest, so a forged value opens nothing. ADR-013 and SPEC-m5 §3 say so now.
- **Server actions, not a new route:** `openFarm` and `acceptAndOpen` on `/organizations` (Next's Origin check), then the dashboard. Opening a farm is audited (`Membership`, `open`).
- **Invitations for someone already elsewhere** stay pending (as before) and show on `/organizations`, where the person accepts them; only an invitation to their own phone, unexpired. No chooser right after sign-in: the oldest farm opens, and "Changer d’exploitation" appears in "Plus" as soon as there is a second farm or an invitation.
- The phone needed nothing new: each signed-in page stores the server's organisation, and every farm already has its own database (ADR-003).
**Size:** M

### T93: Partners on the members screen (PA6)
**Description:** role and end date shown; the owner removes a partner; partner sign-ins audited.
**AC:**
- [x] Removed partner: next pull refused (integration + Playwright). (`identity/organizations.int.test.ts`: a farm that removes its vet is closed to them at once, their other farm still opens. Role and end day on the members screen came with T90, `e2e/partners.spec.ts`; removal is the existing "Retirer", `e2e/members.spec.ts`.)

Done 2026-11-18 with T92 (no separate branch): opening a farm is audited; sign-ins already are.
**Size:** S

### T94: Price log (MP1, MP3)
**Description:** module `market-prices` (light): `PriceObservation`, `market-prices.recordPrice`; units fixed per product; synced entity never sent to workers.
**AC:**
- [x] Recorded once, integer centimes > 0, workers refused and never pull a price, other organisations isolated (integration). (`market-prices/prices.int.test.ts`; `domain/prices.test.ts` for the latest and its change)

Done 2026-11-18 (branch `feat/t94-prices`, with T95), decisions taken without asking:
- **Per organisation, not per farm:** `market-prices` may only depend on `identity` and `reference-data` (CAPABILITY-MAP), so a price says where or what it was seen on as free text instead of pointing at a farm. SPEC-m5 MP1 says so now.
- **Units fixed per product:** chick and cull hen by the head, feed and live broiler by the kg, egg by the egg (no tray size assumed).
- **New action `prices.record`** (owner, manager). Reading prices is `money.read`, so the accountant sees them and records none; workers and vets receive none (vets: hidden in the partner view).
- **Recorded once, never edited,** like advances: a wrong price is followed by the right one.
**Size:** S

### T95: /prices (MP2)
**Description:** static shell: latest per product with its change, then the history; the form.
**AC:**
- [x] A price recorded offline shows as latest, survives a reload and syncs once (Playwright). (`e2e/prices.spec.ts`: two prices, the latest with "+0,50 DH depuis le précédent")

Done 2026-11-18 with T94: `/prices` is precached and linked from "Plus" (money group). The latest per product in a fixed order, then the full history, newest first.
**Size:** S

### T96: Planned batches (PL1, PL5)
**Description:** module `planning` (light): `PlannedBatch` (create, edit until placed, cancel) and `PlanningSettings` (minimum downtime with source, dated). Pure `domain/plan.ts`: sale day, gaps, overlaps.
**AC:**
- [x] Unit: sale day; gap; overlap with the open batch and between plans; no overlap claimed without a sale age; downtime warning only with a minimum entered. (`planning/domain/plan.test.ts`)
- [x] Workers refused; chick price stripped for workers; isolated (integration). (`planning/plans.int.test.ts`)

Done 2026-11-18 (branch `feat/t96-planning`, with T97), decisions taken without asking:
- **No new permission:** plans use `flock.manage` (owner, manager: the people who place batches); the minimum downtime uses `organization.manage` (owner). Keeps the shared role table, and `/batches`'s JS, as they were.
- **An open batch's sale day** is known only when it was placed from a plan with a sale age (T98); otherwise nothing is claimed after it.
- **Gaps and overlaps compare each slot with the one just before it** in placement order.
- **Edit = save again while planned** (the server accepts it); the screen offers "Annuler" and a new plan, not an edit form yet.
- Planning is hidden from both partner roles (allowlist test updated).
**Size:** M

### T97: /planning (PL2)
**Description:** static shell: per house, open batch and plans in order, gaps and warnings; the plan form.
**AC:**
- [x] A plan added offline overlapping the open batch shows the warning, survives a reload and syncs once (Playwright). (`e2e/planning.spec.ts`: three plans, one placed before the previous sale, one 10 days after a sale with a 14-day test minimum.)

Done 2026-11-18 with T96: `/planning` is precached and linked from "Plus" (farm group); the owner's minimum with its source on top, or "non saisi".
**Size:** S

### T98: Place from a plan (PL3)
**Description:** the placement form prefilled from the plan; one mutation places the batch and marks the plan placed (flock's placement through `flock/index.ts`).
**AC:**
- [x] Placing twice from one plan places one batch (integration); the plan shows "Mis en place" (Playwright). (`planning/plans.int.test.ts`: twice → one batch, `ALREADY_DONE`; a second open batch in the house is still refused and the plan stays planned. `e2e/place-from-plan.spec.ts`: placed offline, the house shows the batch with the plan's sale day, then one batch and the plan placed on the server.)

Done 2026-11-18 (branch `feat/t98-place-from-plan`), decisions taken without asking:
- **`planning.placeFromPlan` calls flock's own `placeBatch`** (now exported by `flock/index.ts`) in the same transaction: every placement rule applies (strain, one open batch per house, the day), then the plan is marked placed with the batch's id.
- **The form lives on `/planning`, not `/batches`:** prefilled from the plan (chicks, strain, hatchery, booked price); it asks what only the delivery says (dead on arrival, delivery note, day-old weight) and the vaccination protocol, then sends the vaccination plan as `/batches` does. `/batches` has no room in its JS budget.
- "Mettre en place" shows from the day before the planned day (the server accepts up to tomorrow), so an early or late delivery is still placed from its plan.
**Size:** M

### T99: Reminder the day before (PL4)
**Description:** a daily job like the vaccination reminders: one notification per plan the day before, to owners and managers, held by quiet hours.
**AC:**
- [x] Once per plan, none for a cancelled or placed plan (integration, fixed clock). (`planning/reminders.int.test.ts`: once, owners and managers only, none for a cancelled, a placed or a later plan.)

Done 2026-11-18 (branch `feat/t99-placement-reminder`), decisions taken without asking:
- **Claimed once** with `PlannedBatch.remindedAt` in one `UPDATE … RETURNING`, the notifications in the same transaction, like the instrument reminders; run by `POST /api/push/dispatch` with the others.
- **From the start of the farm day before**, not urgent: quiet hours hold it (N2). Template `placementTomorrow`: house, chicks, hatchery (no price: no money in the message).
**Size:** S

### ✅ Checkpoint M5
- [ ] The owner reviewed SPEC-m5, ADR-013 and NQ1–NQ7; a real vet used the access for a week.
- [ ] SPEC-m5 §9 criteria met. (§9.1 `e2e/switch-farm.spec.ts` + `app/api/sync/partners.int.test.ts`; §9.2 the same test file, accountant part; §9.3 `identity/partners.int.test.ts`, `identity/organizations.int.test.ts`; §9.4 `e2e/place-from-plan.spec.ts` + `planning/reminders.int.test.ts`; §9.5 each task's verification.)

## Later
- Farm-level partner scope (NQ1), regional price index (NQ2), FISA prices (NQ3), seasonality (NQ5), vet signature (NQ6), accountant writes (NQ7), best selling day (OQ5), bank and insurer access.
