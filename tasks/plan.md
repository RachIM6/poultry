# Implementation plan: M1 "Broiler core"

_v0.1, 27 Oct 2026. Status: **approved** (27 Oct 2026). Implements [SPEC.md](../SPEC.md) §8 for the M1 modules in [CAPABILITY-MAP.md](../CAPABILITY-MAP.md). Detailed tasks are in [todo.md](todo.md)._

## Overview

M1 delivers one thing: **a pilot farm can run a full broiler batch on a phone, offline**: placement → daily entry → vaccines and treatments → sales → closing with KPIs and cost per kg. It covers 8 modules:
- `identity`, `farm-registry`, `reference-data`, `notifications`
- `inventory`, `flock`, `health`, `sales`

…plus the cross-cutting foundations (PWA, i18n / RTL, offline sync, tenancy).

## Architecture decisions

| ADR | Decision | Status |
|---|---|---|
| [001](../docs/decisions/ADR-001-pwa-only-client.md) | PWA only (Serwist + IndexedDB) | Accepted |
| [002](../docs/decisions/ADR-002-nextjs-modular-monolith-postgres.md) | One Next.js app, modules in `src/modules/<id>`, PostgreSQL + Prisma | Accepted |
| [003](../docs/decisions/ADR-003-offline-first-sync.md) | Local-first writes + outbox + idempotent push + versioned pull | Proposed → confirmed at checkpoint C |
| [004](../docs/decisions/ADR-004-i18n-arabic-french-rtl.md) | next-intl, `ar` (RTL, default) + `fr`, Western digits | Accepted |
| [005](../docs/decisions/ADR-005-phone-otp-auth.md) | Phone + OTP, database sessions | Accepted (T5): Better Auth 1.7.14, cookie `__Secure-sid`. SMS provider still open (OQ2) |
| [006](../docs/decisions/ADR-006-multi-tenancy-and-audit.md) | `organizationId` scoping via tenant context + append-only audit | Proposed |
| [007](../docs/decisions/ADR-007-data-protection-and-hosting.md) | Law 09-08: synthetic data until hosting + CNDP are settled | Proposed, blocks T26 |
| [009](../docs/decisions/ADR-009-zod-free-shared-files.md) | Zod-free `shared.ts` per module for the phone's screens (T25) | Accepted |
| [010](../docs/decisions/ADR-010-accounting-model.md) | One double-entry ledger, charts as data (CGNC + PCA overlay), staged finance. Not M1: see [plan-m2-finance.md](plan-m2-finance.md) | Proposed, accountant review |
| [011](../docs/decisions/ADR-011-files-in-postgres.md) | Uploaded files live in PostgreSQL (T43) | Proposed, revisit with hosting |
| [012](../docs/decisions/ADR-012-no-separate-backend.md) | No separate backend | Accepted |
| [013](../docs/decisions/ADR-013-partner-access.md) | Partner access (vet, accountant), M5 | Proposed, to review with SPEC-m5 |
| [014](../docs/decisions/ADR-014-compacted-pull.md) | Compacted first pull | Accepted (decided default, to review) |

## Dependency graph (M1)

```
T1 scaffold ─┬─ T2 db/test harness ─┬─ T5 OTP auth ── T6 org + tenancy ── T7 members/roles
             ├─ T3 i18n/RTL         │                      │
             └─ T4 PWA shell        └──────────────── T8 sync server ── T9 sync client ── T10 farms & houses (1st offline slice)
                                                                                              │
                     T11 reference data ── T12 notifications ── T13 stock ledger ── T14 valuation + alerts
                                                                                              │
                                             T15 batch ── T16 daily entry ── T17 weighings ── T18 KPIs
                                                                                              │
                                                         T19 vaccine plan ── T20 treatments + withdrawal
                                                                                              │
                                     T21 sales ── T22 receivables ── T23 origin doc ── T24 batch closing
                                                                                              │
                                                              T25 security + perf ── T26 pilot deploy
```

## Task list (index; details in todo.md)

### Phase 1: Foundation
- [x] T1 Scaffold app and tooling
- [x] T2 Database and integration-test harness
- [x] T3 i18n Arabic/French with RTL shell
- [x] T4 PWA shell (install + offline fallback)
- [ ] **Checkpoint A:** app builds, installs, switches AR ↔ FR, CI green (open: install on a real Android phone, human review)

### Phase 2: Identity & tenancy
- [x] T5 Phone OTP login and sessions
- [x] T6 Onboarding: organisation, legal entity, tenant context
- [x] T7 Members, roles and field visibility
- [ ] **Checkpoint B:** two organisations cannot see each other. A worker cannot see money (open: human review; the isolation tests pass)

### Phase 3: Offline sync (highest risk, so it comes early)
- [x] T8 Sync server: idempotent push, versioned pull
- [x] T9 Sync client: Dexie, outbox, status indicator
- [x] T10 Farms and houses offline (first full offline slice)
- [ ] **Checkpoint C:** a real Android phone and an installed iPhone go offline → edit → reload → online → converge. **ADR-003 confirmed or revised** (open: needs real devices)

### Phase 4: Reference data, notifications, stock
- [ ] T11 Reference data: strains, curves, vaccine protocol, catalogue (built; no curve values committed yet: OQ5, licence)
- [ ] T12 Notifications: inbox, web push, quiet hours (built; push on a real phone not verified)
- [x] T13 Stock ledger: purchases and supplier credit
- [x] T14 Stock valuation and low-stock alerts
- [ ] **Checkpoint D** (open: push and offline reference data on real devices)

### Phase 5: Flock
- [x] T15 Create batch (placement)
- [ ] T16 Daily entry with automatic feed consumption (built; the 60 s test with 3 testers needs people)
- [x] T17 Weighings and uniformity
- [x] T18 KPI engine and batch dashboard
- [ ] **Checkpoint E:** 10 simulated days of a batch, offline, with KPIs matching hand calculations (open: human review)

### Phase 6: Health
- [ ] T19 Vaccination plan, reminders, mark as done (built; push on a real phone not verified)
- [x] T20 Treatments, withdrawal period, vet visit log
- [ ] **Checkpoint F:** vet reviews the default protocol and the withdrawal behaviour (OQ4) (open: needs a vet)

### Phase 7: Sales & closing
- [x] T21 Buyers and live-bird sales (with withdrawal block)
- [ ] T22 Receivables and due-date reminders (built; push on a real phone not verified)
- [x] T23 Printable origin document
- [x] T24 Batch closing and cost per kg
- [ ] **Checkpoint G:** the full M1 journey passes e2e in AR and FR (open: human review)

### Phase 8: Pilot readiness
- [ ] T25 Security review and performance budget (security review done, the high finding fixed; a real mid-range Android measurement and a Lighthouse report are owed)
- [ ] T26 Pilot deployment (blocked by OQ1, OQ2; the host-independent parts are done, see todo.md)
- [ ] **Checkpoint M1:** SPEC §9 success criteria met (open: needs the pilot)

## Later milestones (state on 2026-11-24)

M2 to M6 and the UI track are built and merged into `develop`; each plan keeps its own task ticks. What is open is review by people, real data or the pilot, not code.

| Milestone | Plan | Tasks | Built | Open |
|---|---|---|---|---|
| M2 finance | [plan-m2-finance.md](plan-m2-finance.md) | T27–T39 | all | Checkpoint: expert-comptable review, one exported month imported, the pilot batch margin checked |
| M2 compliance | [plan-m2-compliance.md](plan-m2-compliance.md) | T40–T49 | all | Checkpoint: a vet or ONSSA contact reviews the register, disposal methods and inspection checklist |
| M3 production types | [plan-m3.md](plan-m3.md) | T50–T68 (T69 reserved) | all | none listed |
| M4 farm operations | [plan-m4.md](plan-m4.md) | T70–T77, T80–T84, T86 | all | T78 CNSS export, blocked on MQ3. Checkpoint: the owner's sources (MQ1, MQ2), a manager using routines for a week |
| M5 network | [plan-m5.md](plan-m5.md) | T90–T99 | all | Checkpoint: owner review of SPEC-m5, ADR-013; a real vet using the access for a week |
| M6 accounting close | [plan-m6.md](plan-m6.md) | T100–T119 | all | T117 against the pilot banks' real statement files, T118 imported by the pilot's firm, checkpoint: expert-comptable review and a pilot company closing a year |
| UI | [plan-ui.md](plan-ui.md) | U1–U17 | all | Arabic check with a native speaker |

The `Status: draft` line at the top of each plan was written at the start and not updated.

## Parallelization

There is one developer stream by default. If more people join:
- **After T2:** T3 and T4 can run in parallel with T5–T7.
- **After T10:** T11 and T12 are independent. T13 needs T11 (items reference the catalogue).
- **After T18:** T19–T20 (health) and T21 (sales, without the withdrawal check) can start in parallel. The withdrawal check in T21 waits for T20.
- These must stay sequential:
  - **Prisma migrations:** one at a time, rebase before you migrate.
  - **sync protocol changes:** ask first.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Home-made sync loses or duplicates data | **High** | Done early (Phase 3). Idempotency + integration tests. Real-device checkpoint C. ADR-003 lists managed engines as a fallback |
| iOS PWA limits (no background sync, storage eviction, push only when installed) | Medium | Sync on foreground, `storage.persist()`, unsynced-changes warning. Measure the iPhone share in interviews (Q3) |
| Large MVP scope with no deadline turns into endless building | High | Milestones M1–M5, each pilotable. Do not start M2 before checkpoint M1 |
| Wrong default vaccine protocol or withdrawal logic | High (legal, birds) | Vet review at checkpoint F (OQ4). Protocol is editable per farm |
| Strain curve data licence or accuracy | Medium | Record source and version per value (OQ5). Curves can be swapped without code changes |
| Hosting / CNDP not settled in time | Medium (blocks pilot) | Start the CNDP file and the hosting decision now, in parallel with Phases 1–7 |
| Low-end phones too slow | Medium | 200 KB JS budget, measured at T25 on a real device |
| OTP cost or deliverability (SMS / WhatsApp) | Medium | Rate limits from day 1. Provider chosen before T26 (OQ2) |

## Open questions

See [SPEC.md §10](../SPEC.md). The ones that block M1 tasks:
- **OQ1 hosting:** blocks T26.
- **OQ2 OTP provider:** blocks T26 (dev uses a console sink).
- **OQ4 vet review:** gates checkpoint F.
- **OQ5 curve source:** needed for T11.
