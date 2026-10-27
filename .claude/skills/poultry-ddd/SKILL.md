---
name: poultry-ddd
description: Architecture rules for the poultry farm platform (Next.js 16 modular monolith + Prisma + PostgreSQL, offline-first PWA). Covers module strictness levels, domain/application/infrastructure layers inside src/modules/<id>, isomorphic pure domain code that also runs offline in the browser, Result-based business errors, the Clock and farm-day rules, configurable thresholds, audit, sync mutations, and cross-module boundaries from CAPABILITY-MAP.md. Use this skill whenever writing, refactoring, reviewing or planning any domain or server code in this repository (new module, entity, business rule, KPI, status change, mutation, repository, migration or test), even if the user doesn't mention DDD, architecture or layers.
---

# Poultry platform: DDD rules

Adapted from the `cdoc-ddd` skill (EMSI portal) to this project:
- Next.js instead of NestJS;
- offline-first sync instead of a REST API per resource;
- farm business rules.

Sources of truth:
- `SPEC.md`: conventions and boundaries;
- `CAPABILITY-MAP.md`: modules and allowed dependencies;
- `docs/decisions/` (ADR-002, 003, 006, 008).

This project uses **selective DDD**:
- **Strict** tactical DDD where the farm rules live.
- **Light** layered code for reference data and plumbing.

Identify the module and its level before writing code.

## 1. Modules and strictness

| Module id | Level | Owns (aggregates / main records) |
|---|---|---|
| `flock` | **Strict** | Batch (placement, daily entries, weighings, closing), KPIs |
| `health` | **Strict** | VaccinationPlan, Treatment (withdrawal), VetVisit |
| `inventory` | **Strict** | StockItem + Movement ledger, Supplier balance, valuation |
| `sales` | **Strict** | Sale, Buyer receivable, payment instruments (cheque, bill) |
| `finance` (M2) | **Strict** | Cash book, allocations, accounting export |
| `eggs` (M3) | **Strict** | Egg collection, grading, egg stock |
| `identity` | Generic | User, Membership, Session, OtpChallenge (see `poultry-auth`) |
| `farm-registry` | Light | Organisation, LegalEntity, Farm, House |
| `reference-data` | Light | Species, Strain + standard curves, Protocol templates, Product catalogue |
| `notifications` | Light | Notification, PushSubscription, user preferences |
| `documents`, `market-prices`, `partner-access`, `climate`, `biosecurity`, `planning`, `workforce`, `reporting` | Light until real invariants appear | See CAPABILITY-MAP.md |

**Strict** means:
- a pure domain layer;
- rich aggregates with intention-revealing methods;
- a repository per aggregate root;
- domain unit tests for every invariant.

**Light** means:
- a `service.ts` may use Prisma directly, with validation through Zod;
- business rules still live in one place (the service), never in pages, server actions or route handlers.

If a light module starts accumulating interdependent rules or status changes, propose promoting it to strict (update this table + ADR-008). Don't hide the rules in a service.

## 2. Module layout

```
src/modules/<id>/
  index.ts          public API: the ONLY file other modules and app code import
  schema.ts         Zod schemas + mutation types, shared by client (offline) and server (sync push)
  domain/           strict only. Pure TS: aggregates, value objects, policies, KPI/withdrawal functions
  application/      strict only. Use cases: load → domain method → save + audit, in one transaction
  infrastructure/   strict only. Prisma repositories + mappers
  service.ts        light only. Prisma + rules in one place
```

Callers:
- `src/app/**`: pages, server actions, route handlers;
- `src/lib/sync/server.ts`: applies sync mutations;
- `src/offline/**`: client sync and local reads.

All three call the module **only through `index.ts`**.

## 3. Non-negotiable rules (all modules)

1. **`domain/` is pure and isomorphic.** No imports from `next/*`, `react`, `@prisma/client`, `server-only`, Node built-ins, or `application/` / `infrastructure/`.
   - Domain functions (KPIs, withdrawal end date, vaccine plan generation, stock valuation) run in **both** the server and the offline client. Write them once.
   - Enforced by ESLint (`eslint.config.mjs`) and tested in `eslint.boundaries.test.ts`.
2. **Module boundaries follow CAPABILITY-MAP.md.**
   - Import another module only through its `index.ts`, and only if it is a declared dependency.
   - Never query another module's tables. Ask its `index.ts` for what you need.
   - Enforced by ESLint.
3. **Each table has one owning module.** Only the owner writes to it.
4. **Reference other aggregates by ID** (`batchId: BatchId`), never by object.
5. **Every farm-data read and write takes the tenant context `ctx`** (ADR-006). No repository function without `ctx`.
6. **Never call `new Date()` or `Date.now()` in domain or application code.** Inject a `Clock`.
   - Ages, withdrawal dates and due dates are **farm days** (`FarmDay`, a `YYYY-MM-DD` value in `Africa/Casablanca`). See `references/tactical-patterns.md` §1.
   - Morocco changes its UTC offset around Ramadan, so never compute farm days from a fixed offset.
7. **No hardcoded business thresholds.**
   - Withdrawal days come from the product. Vaccine due days come from the protocol. Standard curves come from reference data.
   - Alert thresholds, quiet hours and OTP limits come from settings or config.
   - A literal like `42` (days) in a rule is a bug.
8. **Integers for quantities:** money in centimes (`bigint`), weights and feed in grams, water in millilitres. Divide only for display.
9. **Every state change writes an audit event in the same transaction** (ADR-006): who, what, before / after, `mutationId`, device time vs server time.
10. **Never return Prisma models to the client.** Map to the schema / DTO defined in `schema.ts`, and strip money fields for workers (SPEC I5).

## 4. Tactical rules (strict modules)

- **The aggregate root is the only entry point.** `DailyEntry` and `Weighing` change only through `Batch` methods: `batch.recordDay(...)`, `batch.recordWeighing(...)`, `batch.close(...)`.
- **No public setters.** No `batch.status = 'CLOSED'` from a service.
- **Expected business failures return `Result`**, for example `fail('HOUSE_HAS_OPEN_BATCH')` or `fail('WITHDRAWAL_IN_PROGRESS')`. Throw only for programming errors.
  - Error codes double as i18n `messageKey`s (`errors.HOUSE_HAS_OPEN_BATCH` in `ar.json` / `fr.json`).
- **Status changes use a typed transition table** inside the aggregate. Example for a batch: `OPEN → CLOSED`, with no reopen in v1.
- **Value objects** for anything with validation or a format: `FarmDay`, `Grams`, `Centimes`, `PhoneNumber` (E.164 +212), `OnssaAuthorizationNumber`, `Lot`, `WithdrawalPeriod`. Immutable, built through `create()` → `Result`, compared by value.
- **Repository per aggregate root**, with intention-named methods (`findOpenByHouse`, `findWithActiveWithdrawal`), never a generic `findMany(where)`.
- **Use cases orchestrate:** load → domain method → save + audit in one transaction → return DTO. They contain no business `if`s.
- **Cross-module side effects** (notify a user, deduct stock) go through the target module's `index.ts` function, **inside the same transaction** when they write data:
  - `inventory.recordConsumption(ctx, tx, …)`;
  - `notifications.notify(ctx, tx, …)`. This writes the inbox row. Push delivery happens after commit, from that row, so the row works like an outbox.
  - Never send a push or SMS before the commit.

Code templates: `references/tactical-patterns.md`.

## 5. Offline-first rules (ADR-003)

- Every write that works offline is a **mutation** declared in the module's `schema.ts`: `{ type: 'flock.recordDay', payload }`.
  - The client applies it to Dexie through the domain function.
  - The server applies it through the use case.
  - The **same Zod schema** validates both sides.
- **Record ids are UUIDv7 generated on the client.** Use cases accept the id. They never generate their own for client-created records.
- **Mutations must be idempotent.** Replaying a `mutationId` returns the stored result.
- **Uniqueness rules are enforced on the server** (one open batch per house, one daily entry per batch per farm day). A violation is a `rejected` mutation result with a `messageKey`, never a 500.
- **Server-computed values are recomputed on the server** (stock valuation, KPIs). The client shows provisional values until the next pull.

## 6. Domain rules to respect (from SPEC §8)

Encode them in the owning aggregate. Parameters come from reference data or settings:

- **One open batch per house.** → `flock`
- **One daily entry per batch per farm day.** Concurrent offline entries merge, last write wins per field, overwritten values go to the audit log. → `flock`
- **Feed in a daily entry creates exactly one consumption movement.** Editing the entry updates that movement. → `flock` + `inventory`
- **Stock is a ledger of movements.** Never edit a quantity in place. Valuation uses the weighted average cost per item and farm. → `inventory`
- **Vaccination plan generated from the farm's protocol** when the batch is created. Due days come from the protocol. → `health`
- **Withdrawal end = treatment end + the product's withdrawal days.** With overlapping treatments, the latest end wins. → `health`
- **No sale while a withdrawal period is running** on the batch. Checked on the client and enforced on the server. → `sales`
- **Amount = weight × price per kg, in integer centimes.** Weighing gap = farm weight − buyer weight. → `sales`
- **The batch closes when birds on hand reach 0.** After closing, entries are read-only and KPIs plus cost per kg are locked. → `flock`
- **Workers never see prices, costs, amounts or supplier credit.** → serializers in every module

Rules marked ⚠️ in the SPEC (default vaccine protocol, the withdrawal block) need a vet's validation. Don't invent alternatives. Leave a `// TODO(spec OQ4): …` and tell the user.

## 7. Workflow for any domain or server task

1. Identify the module(s) and their level (§1). For each write, identify the owning module.
2. Check `references/glossary.md` for existing names. Reuse terms; don't invent synonyms (it's `Batch`, not `Lot` or `Flock`; `FarmDay`, not `date`).
3. **Strict module:**
   1. domain method / value object + unit test (fixed clock);
   2. use case;
   3. repository + mapper;
   4. mutation schema in `schema.ts`;
   5. wiring through `index.ts`;
   6. integration test (tenant isolation + idempotency).
4. **Light module:** service + schema + integration test.
5. Run the checklist.

## 8. Review checklist

- [ ] `pnpm lint` passes. It covers boundaries and domain purity.
- [ ] No `new Date()` / `Date.now()` outside the `Clock` adapter
- [ ] No hardcoded threshold. The value comes from reference data or settings
- [ ] Quantities are integers (centimes, grams, ml)
- [ ] Status changes only through aggregate methods
- [ ] Expected failures return `Result` with a code that exists in both message files
- [ ] Every repository / service call takes `ctx`. An isolation test exists
- [ ] Mutation is idempotent, validated by the shared Zod schema, with server-side uniqueness
- [ ] Audit event in the same transaction
- [ ] Responses go through the DTO, money fields are stripped for workers
- [ ] Domain unit tests for new invariants (strict). Integration test for the use case / mutation

## 9. Anti-patterns to reject

- **Anemic batch:** a service doing `batch.birdsOnHand -= sale.birds`.
- **Logic in the page:** KPI math in a React component instead of `flock/domain/kpi.ts`.
- **Two implementations of one rule:** a client-only KPI or withdrawal check that differs from the server's. There must be one domain function, used on both sides.
- **Cross-module query:** `sales` reading `health`'s treatment table with Prisma instead of `health.activeWithdrawal(ctx, batchId)`.
- **Mutable stock:** `UPDATE stock SET quantity = …`.
- **Float money:** `price * 1.0`, `Number(amount)` on centimes.
- **Server-generated ids** for records the client created offline. That breaks idempotency and offline references.
- **Ceremony in light modules:** ports and mappers for a CRUD on `House`.
