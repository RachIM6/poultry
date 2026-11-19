# ADR-006: Shared database with organisation scoping, and an append-only audit log

## Status
Proposed

## Date
2026-10-27

## Context
- Each customer is an **organisation**. It owns one or more legal entities and farms. Users belong to organisations with a role.
- One user can belong to several organisations, for example a vet or accountant later, or a family member.
- Farm data must never leak between organisations.
- Edits to records (daily entries, sales) need a history. Reasons: disputes, ONSSA inspections, the sync rule "last write wins" (ADR-003).

## Decision
- **One PostgreSQL database and one schema.** Every farm-data table has a non-null `organizationId` column, with an index on it.
- All reads and writes go through a **tenant context** built from the session (`ctx = { userId, organizationId, role, farmIds }`). Repository functions require `ctx`, so a query without a tenant cannot be written by accident.
- Permissions are checked in one place (`can(ctx, action, resource)`), using a role → action table.
- **Audit log:** an append-only `AuditEvent` table with these fields: `organizationId`, `userId`, `entity`, `entityId`, `action`, `before`, `after` (JSON), `deviceCreatedAt`, `serverReceivedAt`, `mutationId`.
  - It is written in the same transaction as the change.
  - Rows are never updated or deleted, except when the whole organisation is deleted (ADR-007).

## Alternatives Considered
- **Database or schema per tenant:** strong isolation, but heavy for many small farms (migrations × N). Rejected.
- **Postgres Row-Level Security now:** a strong second line of defence, but it complicates Prisma connections and pooling. Deferred: reconsider after the pilot, as defence in depth.

## Consequences
- Integration tests must prove isolation for every endpoint: a user from organisation A gets 404 or 403 on B's data.
- Admin and support tools that cross tenants are separate and logged.
- The audit log grows with every edit. Partition or archive it by year if it gets big.
