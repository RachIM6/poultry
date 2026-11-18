# Implementation plan: M5 network

_v0.1, 18 Nov 2026. Status: **draft**, written while the owner was away. Implements [SPEC-m5.md](../SPEC-m5.md) (`partner-access`, `market-prices`, `planning`) and [ADR-011](../docs/decisions/ADR-011-partner-access.md). Task numbers T90–T99 (T70–T89 are M4)._

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

### T91: Partner pull allowlist (PA4, PA5, ADR-011)
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
**Description:** signed cookie with the chosen organisation; `POST /api/auth/organization` (same origin, a membership of the user); a chooser after sign-in when the user has several live memberships; "Changer d’exploitation" in the menu.
**AC:**
- [ ] A user with two memberships switches; each organisation's data stays in its own phone database (Playwright).
- [ ] A forged cookie or someone else's organisation falls back to the oldest live membership (integration).
**Size:** M

### T93: Partners on the members screen (PA6)
**Description:** role and end date shown; the owner removes a partner; partner sign-ins audited.
**AC:**
- [ ] Removed partner: next pull refused (integration + Playwright).
**Size:** S

### T94: Price log (MP1, MP3)
**Description:** module `market-prices` (light): `PriceObservation`, `market-prices.recordPrice`; units fixed per product; synced entity never sent to workers.
**AC:**
- [ ] Recorded once, integer centimes > 0, workers refused and never pull a price, other organisations isolated (integration).
**Size:** S

### T95: /prices (MP2)
**Description:** static shell: latest per product with its change, then the history; the form.
**AC:**
- [ ] A price recorded offline shows as latest, survives a reload and syncs once (Playwright).
**Size:** S

### T96: Planned batches (PL1, PL5)
**Description:** module `planning` (light): `PlannedBatch` (create, edit until placed, cancel) and `PlanningSettings` (minimum downtime with source, dated). Pure `domain/plan.ts`: sale day, gaps, overlaps.
**AC:**
- [ ] Unit: sale day; gap; overlap with the open batch and between plans; no overlap claimed without a sale age; downtime warning only with a minimum entered.
- [ ] Workers refused; chick price stripped for workers; isolated (integration).
**Size:** M

### T97: /planning (PL2)
**Description:** static shell: per house, open batch and plans in order, gaps and warnings; the plan form.
**AC:**
- [ ] A plan added offline overlapping the open batch shows the warning, survives a reload and syncs once (Playwright).
**Size:** S

### T98: Place from a plan (PL3)
**Description:** the placement form prefilled from the plan; one mutation places the batch and marks the plan placed (flock's placement through `flock/index.ts`).
**AC:**
- [ ] Placing twice from one plan places one batch (integration); the plan shows "Mis en place" (Playwright).
**Size:** M

### T99: Reminder the day before (PL4)
**Description:** a daily job like the vaccination reminders: one notification per plan the day before, to owners and managers, held by quiet hours.
**AC:**
- [ ] Once per plan, none for a cancelled or placed plan (integration, fixed clock).
**Size:** S

### ✅ Checkpoint M5
- [ ] The owner reviewed SPEC-m5, ADR-011 and NQ1–NQ7; a real vet used the access for a week.
- [ ] SPEC-m5 §9 criteria met.

## Later
- Farm-level partner scope (NQ1), regional price index (NQ2), FISA prices (NQ3), seasonality (NQ5), vet signature (NQ6), accountant writes (NQ7), best selling day (OQ5), bank and insurer access.
