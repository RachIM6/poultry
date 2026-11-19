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
- [x] Ticking twice the same task and day stores one completion; unticking on another day is refused (`TASK_DAY_PAST`). (`workforce/task-done.int.test.ts`)
- [x] Offline: the linked worker ticks a routine, reloads, it is still done; online it syncs (Playwright). (`e2e/my-tasks.spec.ts`: a real invited worker, who doesn't see another employee's routine)

Done 2026-11-17 (branch `feat/t73-my-tasks`), decisions taken without asking:
- **The completion's id is a UUIDv5 of task key + day,** like a daily entry's: two phones ticking the same task converge on one record, and a second tick is "applied" with no change.
- **Only routines and one-off tasks are ticked** (`tickable`); an entry or vaccine row opens its batch, where recording it is what makes it done.
- **No ticking ahead or made up:** a future day is refused (`DAY_IN_FUTURE`), a day more than 7 days back too (`TASK_DAY_PAST`: SPEC X1's offline week), and the task must fall on that day (a one-off of that day, not cancelled; a routine whose rule falls then, a batch routine through `flock.batchPlacedInHouseOn`). An untick is allowed the same farm day only, so past days stay the record. The server's farm day decides. (Raised by the automated security review.)
- **Any member may tick any task of the farm** (`workforce.record`, all roles); the worker's screen only shows them theirs. A worker takes back only their own tick; owners and managers any.
- **The worker's view:** a member linked to an active employee of the farm sees "Bonjour …", the dark "x faites sur y" card with one bar per task, and only the tasks assigned to them. A worker not (yet) in the staff sees the whole farm's list with a note saying the manager can add them. Owners and managers always see every task with its assignee.
- The mockup's "Arrivé à 06:30" chip comes with check-in (T75).
**Size:** M

### T74: Assignment (WF7)
**Description:** `TaskAssignment` (task key + day → employee), `workforce.assignTask`; the manager's list shows the assignee and a "Confier à" select.
**AC:**
- [x] A reassigned task leaves the first worker's list and appears in the other's (unit + Playwright). (Unit: `workforce/domain/tasks.test.ts` since T71; `workforce/assignment.int.test.ts`; `e2e/assignment.spec.ts`: given offline, "Pour : Hamid M.", synced once.)

Done 2026-11-17 (branch `feat/t74-assignment`), decisions taken without asking:
- **One record per task and day,** id = UUIDv5 of organisation + key + day, upserted: the last assignment received wins (no history beyond the audit log). The organisation is in the id (checked on apply) so another organisation can never take this one's id first (automated security review).
- **Any task can be given,** entries and vaccines too (`entry|vaccine|routine|oneoff:<uuid>`), but only to an employee of that farm who works there that day (`EMPLOYEE_NOT_ACTIVE`).
- **Screen:** under each of today's tasks, owners and managers get a "Confier à…" select of the farm's active employees. Today only: planning other days' assignments waits for a need.
**Size:** S

### T75: Attendance (WF9)
**Description:** `Attendance` (employee, day, status, arrival time), `workforce.checkIn` (own linked employee, today) and `workforce.setAttendance` (manager). "Je suis arrivé" on `/tasks`; month grid on `/staff`.
**AC:**
- [x] A worker's `checkIn` for another employee is refused; checking in twice keeps the first time (integration). (`workforce/attendance.int.test.ts`)
- [x] Check-in offline then the manager sees "P" in the grid after sync (Playwright). (`e2e/attendance.spec.ts`)

Done 2026-11-17 (branch `feat/t75-attendance`), decisions taken without asking:
- **One record per employee and day,** id = UUIDv5 of employee + day: the worker's check-in and the manager's edit meet on one record. The employee is checked to be the caller's organisation's first, so no one else can take the id.
- **Check-in** (`workforce.record`): only for the employee linked to the caller, for the farm day the phone recorded it (its clock, in the audit log), within the employee's working period, up to SPEC X1's offline week back, never ahead (automated security review). A second check-in, or one after the manager already set the day, changes nothing.
- **The arrival time is the phone's farm clock** (HH:MM); the server keeps it as sent (it can't know when an offline tap happened).
- **Statuses** present / rest / leave / absent, whole days only (the mockup's "1,25 j d'absence" needs part days: later, with MQ2). A non-present status drops the arrival time.
- **Who sees what:** a worker pulls only their own days (the record carries the linked member); owners and managers everyone's.
- **Screens:** `/tasks` shows "Je suis arrivé", then "Arrivé à 06:30" (`W-Tasks`); `/staff` shows the month grid (P R C A) and a form to set any day (`W-Staff` "Présence").
- Edits of a validated pay month are refused with T77.
**Size:** M

### T76: Advances (WF10)
**Description:** `SalaryAdvance` (employee, day, amount, month deducted), `workforce.recordAdvance`; card on `/staff`.
**AC:**
- [x] Workers never pull advances; amount is integer centimes > 0 (integration). (`workforce/advances.int.test.ts`; `e2e/advances.spec.ts` offline)

Done 2026-11-17 (branch `feat/t76-advances`), decisions taken without asking:
- **An advance is recorded once and never edited** (a correction is a new advance, or a different deduction month on the next one); deducted from the month the manager picks, the month it is given or later.
- **Workers never receive any advance,** their own included (W-Staff "Droits"); `money.read` decides.
- **Not posted to finance yet:** the accounts (advances to staff, cash) are for the accountant to confirm; see "Later".
- `/staff` shows the advances still to deduct (this month or later) and the form.
**Size:** S

### T77: Labour rules and monthly pay (WF11, WF12, §2)
**Description:** `LabourRules` (dated, source, no seed) owned by workforce, owner only; `domain/pay.ts` pure; pay table on `/staff`; `PayMonth` frozen by `workforce.validatePay`.
**AC:**
- [x] Unit: gross = wage × paid days; advances deducted; no rules → no deduction and `rulesMissing`; with rules (test fixture values, not real ones) → contributions with the cap, SMAG warning. (`workforce/domain/pay.test.ts`: no rules → contributions `null`, SMAG check `null`.)
- [x] Attendance edit in a validated month is refused (`PAY_MONTH_VALIDATED`). (`workforce/pay.int.test.ts`: attendance, check-in, advances and a second validation.)
- [x] `/staff` shows the "rates not entered" notice with no rules (Playwright). (`e2e/pay.spec.ts`, with the owner's validation)

Done 2026-11-17 (branch `feat/t77-pay`), decisions taken without asking:
- **No labour figure is in the code or the seed.** `LabourRules` holds what the owner types from a named source: SMAG per day, employee and employer rates on the capped part and on all gross pay (basis points), the monthly cap; every value optional, the source required. Dated, never edited; the version in force on the month's last day applies. The structure (a capped part and an uncapped part) is ours, to be confirmed with MQ2.
- **Pay** (`domain/pay.ts`, the same on the phone and the server): paid days = present + leave ⚠️ MQ2; gross = daily wage × paid days; employee contribution only when all four rates and the cap are entered; net = gross − employee contribution − the month's advances; a warning when the daily wage is below the entered SMAG. Rounded half up per contribution ⚠️ MQ2. No income tax (MQ4).
- **Validation** (`workforce.validatePay`, owner only): the server recomputes the month from its own records and freezes the lines (`PayMonth`, one per farm and month); from then on that month's attendance, check-ins and advances are refused (`PAY_MONTH_VALIDATED`). Managers see the pay; workers receive neither pay nor rules.
- **Screen:** `/staff` "Paie": month, table (days, gross, employee contribution, advances, net, total), the rules in force with their source and the employer's share, or the "not entered" notice; "Valider la paie de …" and "Saisir le SMAG et les taux" for the owner.
- Not posted to finance and no payslip PDF (MQ3, "Later").
**Size:** M

### T78: CNSS declaration export (blocked: MQ3)
Not started until the file format is provided.

### T80: Climate targets (CL1)
**Description:** `ClimateTargetSet` (dated, source, bands JSON) owned by climate, `climate.saveTargets` (owner), `domain/targets.ts` (`targetFor(sets, day, age)`, overlap check). `/climate/targets` shell.
**AC:**
- [x] Unit: latest `validFrom` ≤ day wins; overlapping bands refused; age outside every band → no target. (`climate/domain/targets.test.ts`, with the verdicts of T81 and the "out of range" rule of T82: they are the same small file.)
- [x] Manager refused; a set without source refused (integration). (`climate/targets.int.test.ts`; `e2e/climate-targets.spec.ts` offline)

Done 2026-11-17 (branch `feat/t80-climate-targets`), decisions taken without asking:
- **New light module `climate`** (`shared.ts`, `schema.ts`, `sync.ts`, `domain/targets.ts`); registered in the sync registry.
- **One target set = a dated version per organisation** with a required source and 1–30 age bands; each band may leave any bound empty (that side is never judged). Temperatures are tenths of °C, humidity whole %, ammonia whole ppm. Input bounds (−10 to 60 °C, 0–100 %, 0–500 ppm) only catch typos.
- **Per organisation, not per farm, house type or production type:** the broiler case first; per production type once M3 merges ("Later").
- **Permissions** `climate.manage` (owner: targets) and `climate.record` (everyone: readings, T81). Everyone pulls the targets, so a worker's phone judges a reading offline.
- **`/climate/targets`** (static shell, "Plus" → "Cibles de climat"): the set in force with its source, or "Aucune cible saisie…"; the owner's form adds bands. No CO₂ (the manual mockup has none; sensors are `iot`).
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
