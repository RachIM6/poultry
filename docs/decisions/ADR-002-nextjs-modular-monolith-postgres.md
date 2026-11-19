# ADR-002: Single Next.js app as a modular monolith, PostgreSQL + Prisma

## Status
Accepted

## Date
2026-10-27

## Context
- The capability map has 18 MVP modules with one-way dependencies.
- The team is small and there is no deadline.
- The data is relational: organisations → farms → houses → batches → entries, with sales, stock and money linked to batches.
- Money and stock need transactions.

## Decision
- **One Next.js app (App Router)** serves the PWA pages, the route handlers (sync, auth) and the server actions.
- Domain code lives in `src/modules/<module-id>/`. Each module exposes **one public file** (`index.ts`).
- Imports between modules follow the capability-map dependencies. ESLint's built-in `no-restricted-imports` enforces this, with no extra plugin.
- Data is stored in **PostgreSQL 16+**, accessed through **Prisma** (schema, migrations, typed client).

## Alternatives Considered

### NestJS API + separate Next.js front end
- Pros: strong module system and dependency injection; a clean API boundary.
- Cons: two apps to deploy, an extra API contract, more ceremony for a small team.
- Rejected by the product owner (simplicity).

### Supabase / BaaS
- Pros: auth and realtime included.
- Cons: vendor lock-in; data location is constrained by the vendor's regions (see ADR-007).
- Rejected.

### Drizzle instead of Prisma
- Pros: lighter, closer to SQL.
- Cons: the team already knows Prisma.
- Rejected for now. Can be revisited if Prisma limits us.

## Consequences
- Module boundaries depend on discipline plus a lint rule. A module that needs another module's data asks its `index.ts`; it never reads the other module's tables directly in queries.
- A single Prisma schema file holds all models, grouped by module with section comments.
- The domain logic and the sync protocol are not tied to UI components, so they can later move behind a separate API.
