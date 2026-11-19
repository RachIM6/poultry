# Capability map: poultry farm platform

_Draft v0.2, 26 Oct 2026. Status: **approved** (27 Oct 2026). Derived from [SCOPE.md](SCOPE.md). Module ids are fixed once approved; each module will later get its own `SPEC-<id>.md`._

## Decisions so far

| Topic | Decision |
|---|---|
| Client | **PWA only** (installable, offline data entry) |
| Backend | **Next.js (API routes / server actions) + PostgreSQL** |
| Languages | Arabic (RTL) + French. Darija is deferred |
| Production types in MVP | **Broiler, turkey, layers + pullets, beldi / free-range, ducks / quail / other** |
| Deadline | None. Planned **by milestones** |

## MVP modules (18)

| Module id | Responsibility | SCOPE areas | Depends on |
|---|---|---|---|
| `identity` | Users, phone/email + OTP login, roles (owner, manager, worker, vet, accountant), Arabic/French UI | 24 | — |
| `reference-data` | Species and production types, strains + **standard curves** (growth, feed, laying), vaccine protocols, product catalogue (feed phases, medicines with **withdrawal periods**), regions | 6, 9 | — |
| `notifications` | Sends alerts and reminders through WhatsApp, push or email. Respects quiet hours. Has no knowledge of farm data: other modules call it | 24 | `identity` |
| `farm-registry` | Organisation → legal entity (form + accounting profile) → farm → poultry house (area, capacity, type). Equipment list | 2, 24, NEEDS §3 | `identity` |
| `market-prices` | Daily prices by region (chicks, feed, live birds, eggs, old hens) from farmer reports + FISA. Seasonality calendar | 19 | `identity`, `reference-data` |
| `partner-access` | Invite the vet or accountant to a farm, with scoped permissions and the farmer's consent | 20 | `identity`, `farm-registry` |
| `documents` | Document vault (authorization, contracts, lab reports, insurance), expiry alerts | 17 | `farm-registry`, `notifications` |
| `inventory` | Stock items, purchases (incl. **supplier credit**), consumption, lot and expiry, low-stock alerts | 7, 14 | `farm-registry`, `reference-data`, `notifications` |
| `flock` | Batches for **every production type**: chick placement, **daily entry**, weighings and uniformity, KPIs, thinning, pullet → laying house transfer, mixed-age flocks (beldi), closing | 5, 6, 13 | `farm-registry`, `reference-data`, `inventory`, `notifications` |
| `health` | Vaccination plan per batch, treatments, withdrawal tracking, vet visits and prescriptions, post-mortems, lab results, notifiable-disease workflow, **ONSSA register data** | 9 | `flock`, `inventory`, `reference-data`, `partner-access`, `notifications` |
| `climate` | Manual readings (temperature, humidity), heat-stress and power-cut log, alerts, energy use | 8 | `flock`, `notifications` |
| `biosecurity` | Clean-out and disinfection checklist, downtime between batches, visitor log, rodent control proof, dead-bird and manure log | 4, 13 | `farm-registry`, `flock`, `notifications` |
| `eggs` | Egg collection (normal / cracked / dirty…), grading, packing, egg stock and age | 11 | `flock`, `inventory` |
| `planning` | Placement calendar across houses, chick booking, sale-date planning against seasonality and prices | 3 | `flock`, `market-prices`, `notifications` |
| `workforce` | Workers, daily tasks generated from batch age and the health plan, attendance, pay (SMAG), advances, CNSS export | 16 | `identity`, `farm-registry`, `flock`, `health`, `notifications` |
| `sales` | Buyers, sales of live birds / eggs / old hens / manure, weighing gap, **origin document**, receivables, cheques and bills of exchange, **withdrawal-period block** | 10, 11, 13 | `flock`, `health`, `eggs` |
| `finance` | Cash book, payables and receivables, loans, cost allocation, **margin and cost per kg per batch**, export to the accountant per accounting profile | 15 | `farm-registry`, `inventory`, `flock`, `sales`, `workforce` |
| `reporting` | Dashboards, batch closing report, **ONSSA register PDF**, **inspection pack**, PDF/Excel exports | 17, 23 | `flock`, `health`, `biosecurity`, `documents`, `sales`, `finance` |

**Cross-cutting concerns** are not modules. Each gets an ADR instead:
- offline-first sync for the PWA
- i18n with RTL layout
- multi-tenancy and data isolation
- audit log
- law 09-08 compliance (data export and deletion)

**Build layers.** Arrows point one way only, with no cycles. Each layer depends only on the layers above it.

| Layer | Modules |
|---|---|
| L0 | `identity`, `reference-data` |
| L1 | `notifications`, `farm-registry`, `market-prices` |
| L2 | `partner-access`, `documents`, `inventory` |
| L3 | `flock` |
| L4 | `health`, `climate`, `biosecurity`, `eggs`, `planning` |
| L5 | `workforce`, `sales` |
| L6 | `finance` |
| L7 | `reporting` |

## Delivery milestones inside the MVP

Each milestone ends with something **pilot farmers can use**. Validate it in the field before starting the next one.

| Milestone | Delivers | Modules |
|---|---|---|
| **M1: Broiler core** | One farm can run a full broiler batch on the phone, offline: placement → daily entry → vaccines → sale | `identity`, `reference-data` (broiler), `notifications`, `farm-registry`, `inventory`, `flock`, `health`, `sales` (live birds) |
| **M2: Money & compliance** | Margin per batch, cash book, ONSSA register PDF, batch report | `finance`, `reporting`, `documents`, `biosecurity` |
| **M3: All production types** | Turkey, beldi, ducks / quail, pullets → layers with eggs | `reference-data` (all species), `flock` variants, `eggs`, `sales` (eggs, old hens) |
| **M4: Farm operations** | Workers and tasks, climate log | `workforce`, `climate` |
| **M5: Network** | Vet and accountant access, prices, planning | `partner-access`, `market-prices`, `planning` |

## Later (post-MVP)

| Module id | Responsibility |
|---|---|
| `hatchery` | Breeders and incubation |
| `feed-mill` | On-farm feed formulation and mixing |
| `cooperative` | Members, shares, surplus distribution (ristournes), general assembly |
| `integrator` | Contracted farms, inputs advanced, settlement |
| `marketplace` | Buyer matching |
| `assistant` | AI assistant (Arabic / French; voice and Darija later) |
| `iot` | Sensors and controller integrations |
