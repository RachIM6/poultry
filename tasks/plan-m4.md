# Implementation plan: M4 farm operations

_v0.1, 17 Nov 2026. Status: **draft**. Implements [SPEC-m4.md](../SPEC-m4.md) (`workforce`, `climate`). Task numbers T70–T89 (T40–T49 are M2 compliance, T50–T69 M3)._

Definition of done, file layout and verification commands are the same as [todo.md](todo.md). Both modules start **light** (poultry-ddd §1): a `service.ts`/`sync.ts` with Prisma and the rules, and pure, isomorphic rules in `domain/` because the phone runs them too (task list, verdicts, pay). Each task: domain test → integration test (tenant isolation, idempotency, worker stripping) → screen → Playwright spec, then lint, typecheck, `pnpm test`, the spec.

Branches `feat/t<N>-<slug>`, each stacked on the previous one; the first on `docs/m4-plan`, itself on `feat/u12-desktop-home` (#78). Databases `poultry_m4` / `poultry_test_m4`, Playwright on `E2E_PORT=3500`.

Screens are static shells under `src/app/[locale]/(app)/`, precached in `src/app/serwist/[path]/route.ts`, reading IndexedDB. Nothing new in the app shell or on `/batches` (`e2e/budget.spec.ts`, a few hundred bytes of margin): new screens are their own routes, linked from "Plus".

## Dependency graph

```
T70 employees ── T71 day tasks (pure) ── T72 routines + one-off ── T73 "Mes tâches" ── T74 assignment
T70 ── T75 attendance ── T76 advances ── T77 labour rules + pay ── (T78 CNSS export, blocked MQ3)
T80 climate targets ── T81 readings ── T82 alerts
                       T81 ── T83 power cuts ── T84 history
```

The climate chain does not depend on workforce; it is stacked after it only to keep one chain of PRs.

## Tasks

### T70: Employees (WF1–WF3)
**Description:** `Employee` table (workforce), mutations `workforce.saveEmployee` (create or edit, field-level last write wins) and `workforce.markLeft`; synced entity `employee`, wage and CNSS number stripped for workers. `/staff` static shell: list per farm, add / edit form, link to a member.
**AC:**
- [x] A worker pulls employees without `dailyWageCentimes` and `cnssNumber`; a worker's `saveEmployee` is refused (integration test). (`workforce/employees.int.test.ts`; the phone is stripped too.)
- [x] Linking one member to two employees of a farm is refused (`MEMBER_ALREADY_LINKED`).
- [x] An employee added offline on `/staff` survives a reload and syncs once (Playwright). (`e2e/staff.spec.ts`)

Done 2026-11-17 (branch `feat/t70-employees`), decisions taken without asking:
- **Two mutations,** `workforce.createEmployee` and `workforce.updateEmployee` (only the changed fields, like farms); leaving is `leftOn`, no separate mutation.
- **The member link is the phone number:** the server sets `userId` to the member who signs in with the employee's phone, when the employee is saved (`identity.memberByPhone`). A worker invited after their employee record is linked by saving the employee again. No members list on the phone was needed.
- **Workers** pull every employee's name, job and houses (to see who does what), never the phone, wage or CNSS number.
- **Jobs** are a short list: team lead, poultry worker, guard, other.
- `components/scoped.tsx`: the "who is signed in on this phone" gate shared by M4's static shells.
**Size:** M

### T71: Day tasks (WF4, WF7 rule)
**Description:** `workforce/domain/tasks.ts`: `dayTasks(day, records)` → tasks with key, kind, house, time, reason, assignees, done. Pure; reads the flock and health DTOs the phone already has.
**AC:**
- [x] Unit tests: entry task per open batch, done once the entry exists; vaccine due and late, done once recorded; routine every *n* days from its start, not after it stops; one-off on its day; cancelled one-off gone; assignee rule (explicit → house → farm); an employee who left gets nothing. (`workforce/domain/tasks.test.ts`)

Done 2026-11-17 (branch `feat/t71-day-tasks`), decisions taken without asking:
- **`dayTasks(farmId, day, inputs)`** takes plain records (structural types), so it needs no flock or health import and the same records the phone already holds feed it.
- **Two kinds of routine:** every *n* days from a calendar day, or from an age of the house's open batch (e.g. a weighing every 7 days from day 7). A batch routine without an open batch in its house generates nothing.
- **Vaccines:** due that day or late (not yet done), and those done that day (shown done). The day before is the home's job (`Today`), not a task.
- **Order:** untimed tasks first (entry, vaccines), then by time.
- **Assignment** (WF7, the rule only): a reassignment that day (the last one), else the routine's or one-off's own assignee, else the active employees who look after the house, else every active employee of the farm. An assignee who left or hasn't started falls through to the next rule.
**Size:** M

### T72: Routines and one-off tasks (WF5)
**Description:** `Routine` and `OneOffTask` tables and mutations (`workforce.saveRoutine`, `stopRoutine`, `addTask`, `cancelTask`), manager part of `/tasks`.
**AC:**
- [x] Idempotent, tenant-isolated, worker refused (integration). (`workforce/tasks.int.test.ts`)
- [x] A routine created offline shows in today's list after a reload (Playwright). (`e2e/tasks.spec.ts`, with a one-off task)

Done 2026-11-17 (branch `feat/t72-routines`), decisions taken without asking:
- **`saveRoutine` creates or replaces the whole routine;** stopping is saving it with `stopOn` = today (no `stopRoutine` mutation). Two managers editing one routine offline is rare enough for last-write-wins on the whole record.
- **A one-off task is never deleted,** only cancelled (`cancelTask`), so a phone that saw it learns it was cancelled.
- **Every member pulls routines and one-off tasks** (no money in them): a worker's phone needs the farm's whole list to compute its own.
- **`/tasks`** is a static shell linked from "Plus" for everyone: today's list (each entry or vaccine task opens its batch), and for owners and managers the assignee of each task, "Ajouter une tâche" and the routines with "Arrêter". The ticks and the worker's own view come with T73.
- A batch-age routine has no default start age in the form: the manager types it.
**Size:** M

### T73: "Mes tâches" (WF6, WF8)
**Description:** `TaskDone` (task key + farm day, who, when; deleting it is the untick). `/tasks` static shell (`W-Tasks`): greeting, done count and bar, the list; ticking offline.
**AC:**
- [ ] Ticking twice the same task and day stores one completion; unticking on another day is refused (`TASK_DAY_PAST`).
- [ ] Offline: the linked worker ticks a routine, reloads, it is still done; online it syncs (Playwright).
**Size:** M

### T74: Assignment (WF7)
**Description:** `TaskAssignment` (task key + day → employee), `workforce.assignTask`; the manager's list shows the assignee and a "Confier à" select.
**AC:**
- [ ] A reassigned task leaves the first worker's list and appears in the other's (unit + Playwright).
**Size:** S

### T75: Attendance (WF9)
**Description:** `Attendance` (employee, day, status, arrival time), `workforce.checkIn` (own linked employee, today) and `workforce.setAttendance` (manager). "Je suis arrivé" on `/tasks`; month grid on `/staff`.
**AC:**
- [ ] A worker's `checkIn` for another employee is refused; checking in twice keeps the first time (integration).
- [ ] Check-in offline then the manager sees "P" in the grid after sync (Playwright).
**Size:** M

### T76: Advances (WF10)
**Description:** `SalaryAdvance` (employee, day, amount, month deducted), `workforce.recordAdvance`; card on `/staff`.
**AC:**
- [ ] Workers never pull advances; amount is integer centimes > 0 (integration).
**Size:** S

### T77: Labour rules and monthly pay (WF11, WF12, §2)
**Description:** `LabourRules` (dated, source, no seed) owned by workforce, owner only; `domain/pay.ts` pure; pay table on `/staff`; `PayMonth` frozen by `workforce.validatePay`.
**AC:**
- [ ] Unit: gross = wage × paid days; advances deducted; no rules → no deduction and `rulesMissing`; with rules (test fixture values, not real ones) → contributions with the cap, SMAG warning.
- [ ] Attendance edit in a validated month is refused (`PAY_MONTH_VALIDATED`).
- [ ] `/staff` shows the "rates not entered" notice with no rules (Playwright).
**Size:** M

### T78: CNSS declaration export (blocked: MQ3)
Not started until the file format is provided.

### T80: Climate targets (CL1)
**Description:** `ClimateTargetSet` (dated, source, bands JSON) owned by climate, `climate.saveTargets` (owner), `domain/targets.ts` (`targetFor(sets, day, age)`, overlap check). `/climate/targets` shell.
**AC:**
- [ ] Unit: latest `validFrom` ≤ day wins; overlapping bands refused; age outside every band → no target.
- [ ] Manager refused; a set without source refused (integration).
**Size:** M

### T81: Climate readings (CL2, CL3)
**Description:** `ClimateReading`, `climate.recordReading`; `domain/verdict.ts`; `/climate` shell (`K-Climate`): house, values, target at the batch's age, verdicts.
**AC:**
- [ ] Unit: verdict below / within / above / no target per value.
- [ ] Out-of-bounds values refused on both sides; idempotent; isolated (integration).
- [ ] Reading recorded offline shows "aucune cible renseignée" and syncs once (Playwright).
**Size:** M

### T82: Climate alerts (CL4)
**Description:** in `recordReading`, an out-of-target verdict calls `notifications.notify` (owner, manager, urgent) in the same transaction. Templates in `ar.json` / `fr.json`.
**AC:**
- [ ] One notification per out-of-range reading, none without targets, none on a replayed mutation (integration).
**Size:** S

### T83: Power cuts (CL5)
**Description:** `PowerCut`, `climate.startPowerCut` / `endPowerCut`; "Coupure de courant" on `/climate`; urgent notification on start.
**AC:**
- [ ] A second open cut on the farm is refused (`POWER_CUT_OPEN`); end before start refused (integration).
- [ ] Started offline, ended, synced (Playwright).
**Size:** S

### T84: Climate history (CL6)
**Description:** last readings and cuts per house on `/climate`.
**AC:**
- [ ] The last 10 readings with verdicts and the last 5 cuts with their duration (Playwright).
**Size:** S

### ✅ Checkpoint M4
- [ ] The owner gave the sources for MQ1 and MQ2 and entered them; the pilot farm's manager used routines for a week.
- [ ] SPEC-m4 §9 criteria met.

## Later

- T78 CNSS export and payslips (MQ3), income tax (MQ4).
- Training records and work accidents (SCOPE §16, `W-Staff` "Formations").
- Targets per production type (after M3 merges), sensors and controllers (`iot`), escalation chain (MQ5, OQ2), weather alerts (external service: ask first).
- Pay posted to finance (6171 / 4441 / 4432 in the mockup, to confirm with the accountant).
- Workforce tasks on the "Aujourd'hui" home itself (UI session).
