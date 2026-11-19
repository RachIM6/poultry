# Spec: M4 "Farm operations" (`workforce`, `climate`)

_v0.1, 17 Nov 2026. Status: **draft**. Milestone M4 of [CAPABILITY-MAP.md](CAPABILITY-MAP.md): `workforce` depends on `identity`, `farm-registry`, `flock`, `health`, `notifications`; `climate` on `flock`, `notifications`. Background: [SCOPE.md](SCOPE.md) §8 and §16, [NEEDS-ANALYSIS.md](NEEDS-ANALYSIS.md) §5. Screens: Design canvas https://claude.ai/artifact/HZgtMCvGPH4eJuKmf2nCLV, `W-Staff`, `W-Tasks`, `K-Climate`, `L-Sensors` (French only). Conventions, stack and boundaries from [SPEC.md](SPEC.md) apply unchanged. Plan: [tasks/plan-m4.md](tasks/plan-m4.md)._

## 1. Objective

The farm's people and its houses' climate, on the phone, offline:
- the **manager** knows who works where, gives each worker the day's tasks, and keeps attendance and advances;
- the **worker** opens the app, says they arrived, and sees **their tasks of the day**, generated from the batches' age, the vaccination plan and the farm's routines; they tick them off offline;
- anyone on the farm records the **climate of a house** (temperature, humidity, ammonia) and **power cuts**; a reading outside the farm's targets for the batch's age **alerts the owner and the manager**.

**Users:** owner, manager, worker (SPEC I4). Workers never see wages, advances or pay (SPEC I5, `W-Staff` "Droits").

**Out of scope in M4** (each in §8 or "Later" of the plan): sensors and controllers (`L-Sensors` says "Module futur": the `iot` module, post-MVP), alarm escalation by WhatsApp or phone call (needs OQ2), weather forecasts (an external service: "ask first"), energy costs (gas, diesel and electricity go through finance's quick expense), payslip PDFs, the CNSS declaration file (§8 MQ3), income tax, training records and work accidents.

## 2. Domain figures we do not invent

Climate targets per age and every labour-law figure come from a source the owner gives us. They are stored as **dated configuration**: each version has a `validFrom` farm day and a mandatory `source` (document, edition, page), is never edited in place, and **no values are seeded**. Until a version exists:
- a climate reading is stored and shown with "no target entered", and raises no alert;
- pay shows days, gross and advances, and says the contribution rates and the SMAG are not entered; it computes no deduction and runs no "at least the SMAG" check.

## 3. Concepts

| Concept | Module | Rule |
|---|---|---|
| **Employee** (Ouvrier, العامل) | workforce | A person working on a farm: name, job, phone (optional), housed on the farm, start and leaving dates, **daily wage** (centimes, hidden from workers), CNSS number (optional), the **houses they look after**, and optionally the **member** (identity user) they sign in as. Not every employee has a phone, so an employee is not a member |
| **Day task** | workforce | Computed, never stored: one pure function turns the farm's records into the list of tasks of a farm day. Same function on the phone and the server |
| **Routine** | workforce | A recurring task the manager defines: title, time, every *n* days from a start day, house (or the whole farm), optional assignee |
| **One-off task** | workforce | A task the manager adds for one farm day |
| **Task key** | workforce | Stable id of a day task, from its source: `entry:<batchId>`, `vaccine:<vaccinationId>`, `routine:<routineId>`, `oneoff:<id>`. Completions and reassignments refer to it with the farm day |
| **Attendance** | workforce | One status per employee per farm day: present (with arrival time), rest, leave, absent |
| **Advance** | workforce | Money given to an employee before pay day, deducted from one month's pay |
| **Labour rules** | workforce | Dated configuration (§2): SMAG per day, employee and employer contribution rates on the capped and uncapped parts of gross pay, monthly cap. Owner only |
| **Climate target set** | climate | Dated configuration (§2): bands of batch age (from day, to day) with temperature min/max, humidity min/max, ammonia max. Owner only |
| **Climate reading** | climate | One reading of a house at a time: temperature in **tenths of °C**, relative humidity in **%**, ammonia in **ppm** (optional). Integers |
| **Power cut** | climate | Start and end time, generator started or not, seconds it took, diesel used in **millilitres** |

## 4. `workforce` requirements

### Employees
- **WF1.** The owner or a manager adds, edits and marks as left the employees of a farm, offline (`W-Staff`). An employee who left keeps their history and gets no new task.
- **WF2.** An employee can be linked to a member of the organisation (any role): the server links the member who signs in with the employee's phone number, when the employee is saved. That member then sees the tasks of that employee. One member is linked to at most one employee per farm (`MEMBER_ALREADY_LINKED`).
- **WF3.** Workers receive no wage, no advance, no pay and no CNSS number, of anyone, from the server (stripped in the serializer, SPEC I5).

### Tasks
- **WF4.** The day's tasks of a farm are, for each open batch: the **daily entry** (done once that day's entry exists); each **vaccination due or late** that day (done once recorded); then the routines falling on that day and the one-off tasks of that day. Each task has a house (or none for the whole farm), a time (or none) and the reason it exists ("J31", "tous les 7 jours", "vaccin du plan").
- **WF5.** The owner or a manager creates, edits and stops routines, and adds or cancels one-off tasks, offline. A stopped routine generates nothing from its stop day on; past days keep what was done.
- **WF6.** A routine or one-off task is ticked done by any member who can see it, offline; the tick records who and when. Unticking is allowed the same farm day. Entry and vaccine tasks are done by recording the entry or the vaccination, not by a tick.
- **WF7.** **Assignment:** a task goes to its explicit assignee; otherwise to the active employees who look after its house; otherwise (no house) to every active employee of the farm. The owner or a manager reassigns one day's task to another employee.
- **WF8.** A member linked to an employee sees "Mes tâches" for today: their tasks, done count and a progress bar (`W-Tasks`), offline. The owner and managers see every task of the day with its assignee.

### Attendance and pay
- **WF9.** A linked worker taps "Je suis arrivé": today's attendance becomes present with the arrival time (device clock, farm-day rules). The owner or a manager sets any day's status for any employee, and sees a month grid (`W-Staff` "Présence"), offline.
- **WF10.** The owner or a manager records an advance (employee, day, amount, month it is deducted from), offline (`W-Staff` "Avance en cours").
- **WF11.** **Monthly pay per employee** (owner, manager): paid days = present + leave days ⚠️ (MQ2); gross = daily wage × paid days; advances of the month deducted. With labour rules in force on the month's last day: employee and employer contributions, net, and a warning when the daily wage is below the SMAG. Integer centimes, rounded per line to the centime, half up ⚠️ (MQ2).
- **WF12.** The owner validates a month's pay: the lines are frozen as computed; later attendance edits of that month are refused with `PAY_MONTH_VALIDATED`.

## 5. `climate` requirements

- **CL1.** The owner enters a **climate target set** (§2): valid from, source, and age bands. Saving creates a new version; the set in force on a day is the latest with `validFrom` ≤ that day. Bands of one set may not overlap (`TARGET_BANDS_OVERLAP`). Screen reached from the climate page (`L-Sensors` "Régler les seuils d'alarme").
- **CL2.** Any member records a **reading** for a house, offline (`K-Climate`): farm day and time (default now), temperature, humidity, ammonia if measured. Plausible ranges only (temperature −10.0 to 60.0 °C, humidity 0–100 %, ammonia 0–500 ppm) to catch typos; these are input bounds, not targets.
- **CL3.** The reading screen shows the target for the age of the house's open batch on that day, and a verdict per value: below, within, above, or "no target entered". The verdict is a pure function used on the phone and the server.
- **CL4.** When a reading pushed to the server is outside its target, the owner and managers get one **urgent** notification (house, value, target), in Arabic or French (SPEC N3). A reading with no target, or no open batch, alerts nobody.
- **CL5.** Any member starts a **power cut** ("Coupure de courant": start = now) and ends it with the generator details, offline. Starting one sends an urgent notification to the owner and managers. One open cut per farm at a time (`POWER_CUT_OPEN`).
- **CL6.** The climate page shows, per house, the last readings with their verdicts and the last power cuts with their duration.

## 6. Permissions (added to `src/lib/permissions.ts`)

| Action | Roles | For |
|---|---|---|
| `workforce.manage` | owner, manager | employees, routines, one-off tasks, reassignment, attendance of others, advances, pay |
| `workforce.record` | owner, manager, worker | ticking tasks, checking in (own employee only for a worker) |
| `workforce.validatePay` | owner | WF12 |
| `climate.record` | owner, manager, worker | readings, power cuts |
| `climate.manage` | owner | target sets (CL1) |
| `labour.manage` | owner | labour rules (§2) |

## 7. Screens and offline

| Route | Mockup | Who | Offline |
|---|---|---|---|
| `/tasks` | `W-Tasks` | everyone (a worker: their own) | static shell, precached |
| `/staff` | `W-Staff` | owner, manager | static shell, precached |
| `/climate` | `K-Climate` | everyone | static shell, precached |
| `/climate/targets` | (`L-Sensors` button) | owner | online is enough; static shell anyway |

All four read IndexedDB, write through the outbox (ADR-003), and are linked from "Plus". New screen code loads in its own chunks: nothing is added to the app shell or to `/batches` (budget `e2e/budget.spec.ts`).

## 8. Open questions

| # | Question | Blocks | Default until answered |
|---|---|---|---|
| MQ1 | **Climate targets per age** (temperature, humidity, ammonia) for broilers, and later per production type: which source does the farm follow (strain management guide edition, vet, ONSSA)? | CL1 values | Stored empty; no alert |
| MQ2 | **Labour figures**: SMAG per day in force (sources disagree, NEEDS-ANALYSIS §5), CNSS and AMO employee and employer rates and the monthly cap, whether leave days are paid at the daily wage, rounding. Who is the source (accountant, CNSS circular)? | WF11 deductions | Stored empty; gross only |
| MQ3 | **CNSS declaration file** (Damancom / BDS format) and payslip contents | CNSS export, payslips | Not built |
| MQ4 | Income tax on wages (barème): computed by the app or by the accountant? | Net pay | Not computed; the accountant |
| MQ5 | Escalation of unanswered alarms (WhatsApp, call), per `L-Sensors` | Escalation | In-app + push only (OQ2) |

Defaults decided without asking are listed with each task in the plan.

## 9. Success criteria (M4 done)

1. A worker with a cheap Android, offline for a day, checks in, sees and ticks their tasks, records two climate readings and a power cut; everything syncs once, without duplicates.
2. The owner sees who was present this month and each employee's gross pay; workers see none of it (integration test on every workforce entity).
3. An out-of-range reading reaches the owner and managers once, urgently; a reading without targets alerts nobody.
4. `pnpm lint`, `pnpm typecheck`, `pnpm test`, each task's Playwright spec, and `e2e/budget.spec.ts` pass.
