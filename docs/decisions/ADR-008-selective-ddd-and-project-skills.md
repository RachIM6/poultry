# ADR-008: Selective DDD inside modules, enforced by lint, documented as project skills

## Status
Accepted

## Date
2026-10-27

## Context
- ADR-002 fixed the module boundaries, but not how code is organized **inside** a module.
- The farm rules are real invariants: one open batch per house, the withdrawal block, the stock ledger, cost per kg. They must run **on the server and in the offline client** (ADR-003), so they need a home that depends on no framework.
- The product owner asked to reuse the practices of the EMSI doctoral portal (`cdoc-ddd`, `cdoc-auth` skills), adapted to this project.

## Decision
- **Selective DDD** (skill `.claude/skills/poultry-ddd/`):
  - **Strict modules** (`flock`, `health`, `inventory`, `sales`, later `finance`, `eggs`) use `domain/` (pure, isomorphic) + `application/` (use cases) + `infrastructure/` (Prisma). Business failures are returned as `Result`.
  - **Light modules** use a single `service.ts`.
  - All modules expose `index.ts` and `schema.ts`.
- **Enforced by ESLint**, with no new dependency (dependency-cruiser was used in EMSI). `eslint.config.mjs` checks:
  - module boundaries (CAPABILITY-MAP);
  - `domain/` purity: no Next / React / Prisma / Node imports, and only `@/lib/kernel` from `src/lib`;
  - no `new Date()` / `Date.now()` in `domain/` and `application/`: business code reads time through a `Clock`.
  - `eslint.boundaries.test.ts` proves these rules work.
- **Auth and abuse protection** follow `.claude/skills/poultry-auth/`: phone + OTP, multi-dimensional rate limits, protection against SMS pumping, captcha, uniform responses.
- **Contribution rules** (`CONTRIBUTING.md`): branches per task, Conventional Commits with the module id as scope, merge commits, SHA-pinned CI actions.

## What was not adopted from EMSI, and why
| EMSI practice | Reason |
|---|---|
| NestJS layers, DI with `Symbol` tokens, guards | Next.js stack (ADR-002). Plain functions and `getSession()` instead |
| OIDC (Entra / Google), email OTP | Users log in with a phone number (ADR-005) |
| pg-boss outbox for domain events | No job runner in M1. The notification inbox row, written in the same transaction, acts as the outbox. Revisit with M2 reports / exports |
| `emsi-cedoc-design` skill, shadcn MCP | EMSI brand. This project has no brand or design system yet. Adding shadcn/ui is a separate decision (dependency, RTL check) |
| `develop` branch + staging deploy | No hosting yet (ADR-007) |

## Consequences
- The task file paths in `tasks/todo.md` for strict modules map to `domain/` / `application/` / `infrastructure/` subfolders.
- `src/lib/kernel/` (Result, Clock, FarmDay, branded ids) is created in T2 / T5, the first time it is needed.
- Promoting a light module to strict needs an update of the skill's table and of this ADR.
