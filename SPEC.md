# Spec: poultry farm management platform (Morocco)

_v0.1, 27 Oct 2026. Status: **approved** (27 Oct 2026). Module ids and milestones come from the approved [CAPABILITY-MAP.md](CAPABILITY-MAP.md). The domain background is in [NEEDS-ANALYSIS.md](NEEDS-ANALYSIS.md) and [SCOPE.md](SCOPE.md). Decisions are recorded in [docs/decisions/](docs/decisions/)._

## 1. Objective

An **offline-first, installable web app (PWA)** in **Arabic and French**. It lets Moroccan poultry farms run the whole production cycle:
- placement → daily follow-up → health → sale → money → compliance;
- for every production type (broiler, turkey, layers + pullets, beldi / free-range, ducks / quail / other).

**Primary users**
- **Farm owner:** decisions, money, compliance.
- **Manager:** runs the farm day to day.
- **Worker:** enters daily data on a phone, often a low-end Android, with a weak network.

Vets and accountants come in M5.

**What success looks like**
- A pilot farm runs a **complete broiler batch** in the app, from placement to the last sale, **without internet on the farm**.
- At the end, it knows its **mortality, FCR and EPEF** and its **cost per kg**.
- It has the data needed for the **ONSSA health register** (the PDF itself comes in M2).

**Out of scope for v1:** Darija and voice entry, native apps, hatchery, feed formulation, cooperative and integrator modules, marketplace, AI assistant, IoT. See the capability map, "Later".

## 2. Tech stack

| Layer | Choice | ADR |
|---|---|---|
| Client | **PWA**: Next.js App Router pages, service worker (Serwist), IndexedDB (Dexie) | [ADR-001](docs/decisions/ADR-001-pwa-only-client.md), [ADR-003](docs/decisions/ADR-003-offline-first-sync.md) |
| Server | **Single Next.js app** (route handlers + server actions), TypeScript strict. Modular monolith | [ADR-002](docs/decisions/ADR-002-nextjs-modular-monolith-postgres.md) |
| Database | **PostgreSQL 16+** through **Prisma** | ADR-002 |
| Validation | **Zod**. The same schemas run on the client (offline writes) and the server (sync push) | ADR-003 |
| i18n | **next-intl**. Locales `ar` (default, RTL) and `fr`. Tailwind logical properties | [ADR-004](docs/decisions/ADR-004-i18n-arabic-french-rtl.md) |
| Auth | Phone number (+212) + one-time code (OTP), database sessions in httpOnly cookies | [ADR-005](docs/decisions/ADR-005-phone-otp-auth.md) |
| Tenancy | One shared database. Every farm-data row carries `organizationId`, enforced in one data-access helper | [ADR-006](docs/decisions/ADR-006-multi-tenancy-and-audit.md) |
| Styling | Tailwind CSS | — |
| Tests | Vitest (unit + integration on a real Postgres), Playwright (e2e incl. offline) | — |
| Tooling | Node 22 LTS, pnpm, Docker Compose (local Postgres), GitHub Actions | — |
| Hosting | **Open**: depends on law 09-08 (data location) | [ADR-007](docs/decisions/ADR-007-data-protection-and-hosting.md) |

Exact package versions are pinned in `package.json` when the project is scaffolded (task T1). From then on, the lockfile is the source of truth.

## 3. Commands

```bash
docker compose up -d db        # local PostgreSQL
pnpm install
pnpm db:migrate                # prisma migrate dev
pnpm db:seed                   # reference data + demo farm
pnpm dev                       # http://localhost:3000
pnpm lint                      # eslint (incl. module-boundary rule)
pnpm typecheck                 # tsc --noEmit
pnpm test                      # vitest: unit + integration
pnpm test -- src/modules/flock # one module
pnpm test:e2e                  # playwright (starts the app; includes offline scenarios)
pnpm build                     # production build
```

## 4. Project structure

```
src/
  app/[locale]/...        pages (UI routes), one folder per area
  app/api/sync/...        sync push / pull endpoints
  app/api/auth/...        OTP request / verify / logout
  modules/<module-id>/    one folder per capability-map module
    index.ts              the ONLY file other modules may import
    schema.ts             Zod schemas (shared client/server)
    service.ts            server-side domain logic
    *.ts                  pure domain functions (KPIs, withdrawal, …)
    *.test.ts             tests next to the code
  lib/                    db client, tenant context, auth session, i18n, formatting
  offline/                Dexie database, outbox, sync engine, service worker
prisma/                   schema.prisma, migrations/, seed.ts
messages/                 ar.json, fr.json (every user-facing string)
e2e/                      Playwright tests
docs/decisions/           ADRs
tasks/                    plan.md, todo.md
```

**Module boundary rule:** code in `src/modules/a/` can import `src/modules/b/index.ts` only if the capability map says `a` depends on `b`. The rule is enforced with ESLint's built-in `no-restricted-imports`, configured once per module.

## 5. Code style & domain conventions

```ts
// src/modules/flock/kpi.ts: pure, unit-tested, integers in, numbers out
export type BatchTotals = {
  placed: number;          // birds
  dead: number;            // cumulative, incl. culls
  feedGrams: number;       // cumulative
  liveWeightGrams: number; // sold + estimated on hand
  ageDays: number;
  avgWeightGrams: number;
};

/** FCR = feed consumed / live weight produced. Null until something has been weighed. */
export function feedConversionRatio(t: BatchTotals): number | null {
  return t.liveWeightGrams > 0 ? t.feedGrams / t.liveWeightGrams : null;
}

/** EPEF (European Production Efficiency Factor) = livability% × avg weight kg / (age × FCR) × 100 */
export function epef(t: BatchTotals): number | null {
  const fcr = feedConversionRatio(t);
  if (fcr === null || t.ageDays === 0) return null;
  const livability = ((t.placed - t.dead) / t.placed) * 100;
  return (livability * (t.avgWeightGrams / 1000)) / (t.ageDays * fcr) * 100;
}
```

| Convention | Rule |
|---|---|
| Naming | `camelCase` for code, `PascalCase` for types and Prisma models, `kebab-case` for files and module ids. English in code. Arabic and French only in `messages/` |
| IDs | **UUIDv7, generated on the client**, so records created offline keep their id |
| Money | **Integer centimes** (`bigint` in the database). Never floats. Shown as `1 234,50 DH` |
| Weights / feed | **Integer grams.** Water in **integer millilitres** |
| Time | Timestamps in UTC. **Farm days** (daily entries, ages) are `date` values in the `Africa/Casablanca` zone. Morocco changes its UTC offset around Ramadan, so never derive a farm day from a UTC offset by hand |
| Digits | Western digits (0–9) in **both** locales, as used in Morocco |
| Validation | Zod at every trust boundary (forms, sync push, route handlers). Server-side validation is authoritative |
| Errors | Domain errors return a typed `{ code, messageKey }`. The UI translates `messageKey`. No raw error strings reach users |
| Comments | Explain *why* (rule, legal article, formula source). Nothing else |

## 6. Testing strategy

| Level | Tool | What | Where |
|---|---|---|---|
| Unit | Vitest | Pure domain logic: KPIs, withdrawal dates, vaccine plan generation, stock valuation, weighing stats, sync merge rules. **Every branch covered** | `src/modules/**/*.test.ts` |
| Integration | Vitest + real Postgres (separate test database, reset per file) | Services and route handlers: **tenant isolation**, permissions, **sync idempotency**, migrations | `src/**/*.int.test.ts` |
| E2E | Playwright, mobile viewport, `ar` and `fr` | Main journeys, including **going offline** (`context.setOffline(true)`), reloading, and syncing back | `e2e/` |
| Manual | Real low-end Android phone + an iPhone with the app installed | Install, offline for a whole day, sync | Checkpoints in `tasks/todo.md` |

No global coverage percentage. The bar is: every domain rule in this spec has a test, and every bug fix adds one.

## 7. Boundaries

- **Always**
  - Run `pnpm lint && pnpm typecheck && pnpm test` before every commit.
  - Read and write farm data only through the tenant context.
  - Put every UI string in **both** `ar.json` and `fr.json`.
  - Use integer money, weights and volumes.
  - Generate ids on the client.
  - Write audit events for edits and deletions of farm data.
- **Ask first**
  - Adding a dependency.
  - A migration that drops or renames columns.
  - Changing the sync protocol.
  - Adding an external service (SMS / WhatsApp provider, hosting, analytics).
  - Changing a module's dependencies in the capability map.
- **Never**
  - Commit secrets or `.env`.
  - Log OTP codes or full phone numbers in production.
  - Query across organisations outside the admin tooling.
  - Delete or skip a failing test to get to green.
  - Add Darija strings in v1.
  - Store farm data with a provider or in a location not approved in ADR-007.

## 8. M1 functional requirements (milestone "Broiler core")

These are the testable requirements per module id for M1. They become `SPEC-<id>.md` when a module grows beyond M1.

### `identity`
- I1. Sign up / log in with a Moroccan mobile number and a **6-digit one-time code**:
  - the code expires after **5 min**;
  - **5 wrong attempts** lock the code;
  - **3 code requests per 15 min** per number.
  - Email is optional.
- I2. A session lasts **30 days** on the device and keeps working offline. It is refreshed when the app comes back online.
- I3. Language AR / FR is chosen at first launch and can be changed anytime. The choice is saved on the user.
- I4. The owner invites members by phone number with a role: `owner`, `manager` or `worker`.
- I5. A `worker` can create daily entries, weighings and vaccination records, and can view batches. **A worker cannot see prices, costs, sales amounts or supplier credit.** A `manager` can do everything except organisation settings and member management.

### `farm-registry`
- F1. First login → create the organisation and its **legal entity**:
  - form: individual / indivision / company / cooperative / association / GIE;
  - the accounting profile is derived from the form and used in M2.
- F2. A farm has a name, region and province, commune, optional GPS, and optional **ONSSA authorization number + expiry date**.
- F3. A poultry house has a name, floor area (m²), capacity (birds) and type (open / closed).
- F4. Farms and houses can be created and edited **offline**.

### `reference-data`
- R1. Broiler strains **Ross 308** and **Cobb 500** with **daily standard body weight and cumulative feed** (as-hatched), imported from the breeders' published performance objectives. Each value has its source and version.
- R2. A broiler **vaccination protocol template** (Newcastle, infectious bronchitis, Gumboro…) that the farm can edit. ⚠️ The default template must be **reviewed by a vet** before the pilot.
- R3. Product catalogue: feed phases (starter / grower / finisher), vaccines, and medicines with a **meat withdrawal period in days**.
- R4. Reference data is read-only for farms, cached offline, and versioned.

### `notifications`
- N1. In-app inbox + **web push** (on Android; on iPhone only when the app is installed).
- N2. Quiet hours per user (default 22:00–06:00). Notifications that are not urgent are held until the end of quiet hours.
- N3. Other modules send notifications through one function, `notify(userIds, templateKey, params, urgency)`. Templates exist in AR and FR.
- N4. A WhatsApp channel is added as soon as a provider is chosen (an open question).

### `inventory`
- S1. Stock items per farm: feed (with phase), vaccines and medicines (**lot + expiry**), litter, gas, other.
- S2. A purchase records supplier, date, quantity, unit price, and amount paid now. The rest becomes **supplier credit** with an optional due date. Supplier balance = purchases − payments.
- S3. Stock is a **ledger of movements** (purchase, consumption, adjustment). Quantities are never edited in place. Stock on hand = sum of movements.
- S4. Recording feed consumption (flock) or vaccine / medicine use (health) **creates the consumption movement automatically**.
- S5. Valuation uses the **weighted average cost** per item and farm, so each batch gets its share of input costs.
- S6. An alert fires when stock goes below a threshold set per item.

### `flock`
- B1. Create a batch: house, species broiler, strain, placement date, chicks placed, hatchery, delivery note n°, chick unit price, average day-old weight (optional), dead on arrival. **One open batch per house.**
- B2. **Daily entry, one per batch per farm day:**
  - mortality count + cause (from a list) and culls;
  - feed consumed (item + kg);
  - water (L, optional);
  - note.
  - It can be done **in under 60 seconds** on a phone.
  - It can be edited until the batch is closed. Each edit is audited.
- B3. Weighing: sample birds, entered as individual weights or as a total ÷ count → average weight, and **CV% (uniformity)** when individual weights are entered. Compared with the strain standard for that age.
- B4. Live KPIs: age (days), birds on hand, mortality %, feed per bird, average weight vs standard, **FCR**, **EPEF**, average daily gain. Formulas are in `kpi.ts` and covered by unit tests.
- B5. A sale of part of the birds (thinning, in `sales`) lowers the number of birds on hand while the batch stays open.
- B6. Closing a batch:
  - **automatic** when birds on hand reach 0;
  - **manual** with a reason.
  - The final KPIs and the **cost per kg sold** (chicks + consumed inputs + other costs entered) are then locked.

### `health`
- H1. Creating a batch generates its **vaccination plan** from the farm's protocol (due day = age).
- H2. Reminders the day before and on the due day. Marking a vaccine as done records date, product lot (taken from stock), method and who did it.
- H3. A treatment records product, dose, start and end dates, reason and prescriber (name). **Withdrawal end date = end date + the product's withdrawal days.**
- H4. The batch shows a **"withdrawal in progress until …"** banner while a withdrawal period is running.
- H5. Vet visit log: date, vet name, notes.
- H6. All this data is stored in a form that can rebuild the **ONSSA health register** in M2.

### `sales` (live birds)
- V1. Buyers: name, phone, type (trader / abattoir / live-bird market / other).
- V2. A sale records:
  - batch, date, buyer;
  - number of birds;
  - farm weight (kg) and, optionally, buyer weight → **weighing gap**;
  - price per kg → amount;
  - payment method (cash / cheque / bill of exchange / transfer / credit), amount paid, and for cheques or bills the number and due date.
- V3. **A sale is blocked while a withdrawal period is running** on that batch, with an explanation. There is no override in v1. ⚠️ To be validated with a vet.
- V4. Receivables list: unpaid amounts with their due dates. Reminder on cheque and bill due dates.
- V5. A printable **origin document** per sale, in AR or FR (law 49-99 art. 10).

### Cross-cutting (M1)
- X1. **Offline for at least 7 days:**
  - every M1 action works offline and survives a reload;
  - the sync status is always visible (pending count, last sync);
  - **no data is lost or duplicated** when syncing (idempotent).
- X2. Two devices editing the same farm converge after sync. For the same daily entry, the last write received by the server wins, and the overwritten version stays in the audit log.
- X3. **Tenant isolation:** no API returns or accepts data from another organisation. Integration tests prove it for every endpoint.
- X4. Accessibility basics: touch targets ≥ 44 px, WCAG AA contrast, labels on every input, works at 200% zoom.

## 9. Success criteria (M1 done)

1. **The pilot works.** One real farm completes a broiler batch (placement → last sale → closed). The worker uses the app daily, the owner reads KPIs and the cost per kg. Most entries happen offline.
2. **The e2e suite passes** in `ar` and `fr` on a mobile viewport. It includes this offline journey: create batch → 3 daily entries → weighing → vaccine done → reload → online → synced → visible on a second device.
3. **Performance budget:**
   - First load of the app shell is **≤ 200 KB of JS** (compressed). Measured in the build output.
   - Daily-entry screen is **interactive in under 3 s** on a mid-range Android with Chrome, with "Fast 4G" throttling. Measured with Lighthouse.
   - Fully offline after the first load.
4. **Security:** the OTP limits, session cookie flags (httpOnly, Secure, SameSite=Lax) and tenant-isolation tests all pass. A security review (`security-and-hardening`) has no open high findings.
5. **i18n:** 0 missing keys in `ar` or `fr` (checked in CI). No layout breaks in RTL on the M1 screens (visual check at the checkpoint).

## 10. Open questions

| # | Question | Blocks |
|---|---|---|
| OQ1 | **Hosting location** and law 09-08: host in Morocco, or abroad with a CNDP authorization for the transfer? | Staging / pilot deploy (T25) |
| OQ2 | SMS / WhatsApp provider for OTP and notifications. Cost per message | T5 (production OTP), N4 |
| OQ3 | Minimum supported phones (Android version, RAM, iPhone share): answered by interview question Q3 | Performance budget, T4 |
| OQ4 | Vet review of the default vaccination protocol and of the withdrawal-period block | T10, T19, T20 |
| OQ5 | Source and licence of the strain standard curves (Aviagen / Cobb performance objectives) | T10 |
| OQ6 | Pricing / who pays (farm, integrator, feed supplier) | Not M1 |
