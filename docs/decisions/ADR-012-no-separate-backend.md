# ADR-012: No separate backend; scale the Next.js app out, and split off one piece only when a trigger is hit

## Status
Accepted (2026-11-19). Confirms ADR-002 for growth; changes no code.

## Date
2026-11-19

## Context
- The owner asked whether one Next.js app is enough as the platform grows, or whether it needs a separate backend (NestJS or another).
- ADR-002 already rejected "NestJS API + separate Next.js front end" for simplicity, and kept the domain and the sync protocol independent of the UI so they can move later.
- What the server does today:
  - about a dozen route handlers (sync push and pull, OTP login, the minute scheduler, push, exports) and a few server-action files, over the modules in `src/modules/`;
  - **no state in the process**: sessions and rate-limit counters are in Postgres, and the app uses no Next.js cache (`revalidateTag`, `use cache`);
  - a pull is an index range on `Change (organizationId, version)` and returns nothing most of the time;
  - the health register is built and printed **on the phone** (print CSS), not on the server.
- Load estimate (assumptions, **not measured**):

  | | Realistic first year | Deliberate ceiling |
  |---|---|---|
  | Organisations | 50–500 | 10 000 (stress figure, not market data: the broiler farm count is not published, NEEDS-ANALYSIS) |
  | Devices (≈ 3 per farm) | ≤ 1 500 | 30 000 |
  | Pulls (every 60 s while open, 30 % open at peak) | < 10 req/s | ≈ 150 req/s |
  | Writes | < 1/s | ≈ 3/s average, ≈ 30/s peak |

  Even the ceiling is a small load for a stateless Node process and one indexed Postgres.

## Decision
1. **Keep one Next.js app** (ADR-002). Grow by running **several copies** of the same build behind a load balancer, with **PgBouncer** in front of Postgres once there are more than 3–4 copies.
2. **Running several copies requires** (Next 16 self-hosting guide): the same build in every copy, and one `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` for all of them. No shared cache handler while the app uses no Next.js cache; adding one becomes required the day it does.
3. **Background work moves to a worker process from the same repo**, calling the same module `index.ts` functions, when the first of these shows up:
   - the minute scheduler (`POST /api/push/dispatch`: vaccination and instrument reminders, due pushes) gets slow or hits the host's request time limit;
   - a server-side export or book (finance export, books) slows other requests.
   
   The queue lives in Postgres (no Redis), chosen and vetted at that time.
4. **Known limits, each with its fix, none needing another framework:**

   | Limit | Shows up when | Fix |
   |---|---|---|
   | The change log is never compacted; a new device's first pull reads all of it | Months of history per farm | Compaction (ADR-003, "Later") |
   | One organisation's writes are serialized (`SyncVersion` row lock) | An organisation with many farms (`integrator`, `cooperative`) | A version counter per farm instead of per organisation |
   | One rate-limiter lock per policy | Thousands of logins per second | Per-key locks (noted in `rate-limit.ts`) |
   | Files stored in Postgres (ADR-011, files) | Database size and backups grow with photos | Object storage when hosting is chosen; only `documents/service.ts` changes |
5. **A separate service is justified only by one of these triggers**, and then only **that piece** leaves the app:
   - `iot`: sensor data arriving at high frequency (its own ingestion service, not necessarily Node);
   - `assistant` or analytics: long-running or CPU-heavy work;
   - a separate team, or a public partner API with its own release schedule.

   Native apps are **not** a trigger: the sync protocol is plain HTTP + JSON and they can use it as it is.
6. **Before the pilot**, a load test on `/api/sync/pull` and `/api/sync/push` replaces the estimates above with measured figures.

## Alternatives Considered

### NestJS (or Express / Fastify) API + Next.js front end, now
- Pros: dependency injection and a framework-enforced module system; an explicit API boundary.
- Cons:
  - **no extra capacity**: same Node runtime, same Postgres, same sync design, so the limits above stay where they are;
  - the route handlers and server actions must be rewritten as controllers;
  - login, sessions, CSRF protection and rate limits are built twice or split across two apps;
  - cookies and CORS across two origins are fragile for an offline PWA whose service worker syncs in the background (ADR-003, ADR-005);
  - a second deployment and a versioned API contract to keep in step.
- Rejected: weeks of M2–M5 time for structure the modular monolith and its lint rules (ADR-008) already give.

### Serverless functions (one function per route)
- Pros: automatic scaling.
- Cons: request time limits hurt the minute scheduler; many short-lived processes each open database connections; hosting is open and likely in Morocco (ADR-007), where a long-running process on a VPS or container is the natural fit.
- Not chosen. Revisit with the hosting ADR.

## Consequences
- The architecture stays as built. Growing means more copies, PgBouncer, then a worker process, in that order and only when measured.
- Module code must keep working without a request (no `cookies()` / `headers()` inside `src/modules/`), so a worker can call it. The `poultry-ddd` layering already keeps request handling in `src/app/`.
- The hosting ADR (superseding ADR-007) must say how the scheduler runs (host cron calling the route, or the worker) and how many copies start.
- Reopen this ADR when a trigger in point 5 is hit, or when the load test fails at the realistic figures.
