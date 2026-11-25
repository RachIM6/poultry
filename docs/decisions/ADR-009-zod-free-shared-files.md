# ADR-009: A zod-free `shared.ts` per module, so the phone's screens don't ship Zod

## Status
Accepted. Supersedes the "all modules expose `index.ts` and `schema.ts`" part of ADR-008; the rest of ADR-008 stands.

## Date
2026-11-10

## Context
- SPEC §9.3 sets a budget of ≤ 200 KB of compressed JS for the first load of the app shell.
- T25 measured the daily-entry shell (`/fr/batches`) at **237.6 KB gzip**, 38 KB over (`docs/t25-security-and-performance.md`).
- About 32 KB of it is **Zod**, which validates nothing on that screen. It arrives because the screens import runtime values from `src/modules/<id>/schema.ts`: mutation names, domain functions such as `ageOn` or `withdrawalUntil`, and constants. The same file builds the module's Zod schemas when it loads, so the bundler keeps them.
- `src/lib/sync/protocol.ts` does the same for the sync client: two constants next to the Zod push and pull schemas.
- The product owner chose to restructure rather than write a budget exception (2026-11-10).

## Decision
- **Each module that the phone's screens use gets a `shared.ts`.** It is isomorphic and has **no Zod import**, and holds what the screens need:
  - mutation names;
  - plain DTO types;
  - constants and enums as `as const` arrays;
  - domain functions re-exported from `domain/`;
  - deterministic ids (`dailyEntryId`, `vaccinationId`).
- **`schema.ts` keeps the Zod schemas** and re-exports `shared.ts` (`export * from`). Server code, tests and the forms that validate keep importing `schema.ts` unchanged.
- **The phone's screens import `shared.ts`.** They import `schema.ts` only for types (`import type`), which compile to nothing. The exceptions are the forms that validate with Zod: farms, protocol and stock.
- **The push and pull Zod schemas** move into the two sync route handlers that use them. `protocol.ts` keeps the constants and plain types.
- **Enforced by ESLint:**
  - `@/modules/<id>/shared` joins `index` and `schema` as an allowed entry point;
  - in `src/components/**`, apart from the three validating forms, a value import from `@/modules/<id>/schema` is an error (type imports are allowed);
  - `eslint.boundaries.test.ts` covers both.

## Consequences
- The modules first touched are `flock`, `health`, `inventory`, `reference-data` and `sales`, since those are what the daily-entry screen loads. Other modules adopt `shared.ts` when a screen needs it without validating.
- **One more file per module.** The rule is easy to apply: if a value doesn't need Zod, it belongs in `shared.ts`.
- Validation still uses one schema for both sides, as ADR-003 requires: the phone checks with the domain functions, the server with the schemas.
- The budget is measured again after the change; brotli at the host (T26) is still expected.
