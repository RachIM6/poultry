<!-- claude-reflect: learned rules (saved from the band; edit freely) -->
## Learned rules
- For this platform, use Arabic and French only; do not include Darija in the first version.
<!-- end claude-reflect -->

## Project docs (read before building)
- `SPEC.md`: stack, commands, structure, conventions (integer money/grams, UUIDv7, Africa/Casablanca farm days), boundaries, M1 requirements.
- `CAPABILITY-MAP.md`: module ids and allowed dependencies. Never import across modules except via `src/modules/<id>/index.ts` of a declared dependency.
- `docs/decisions/`: ADRs. Don't re-decide an accepted ADR; write a superseding one.
- `tasks/plan.md` + `tasks/todo.md`: current milestone plan; work tasks in order, tick them when verified.
- Next.js is 16.4: read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (see AGENTS.md).
- `CONTRIBUTING.md`: branch `feat/t<N>-<slug>` from `main`, Conventional Commits with module scope, merge commits.

## Which skill / tool for which work
| Work | Use |
|---|---|
| Any domain or server code (modules, mutations, repositories, KPIs) | `poultry-ddd` (project skill) |
| Login, OTP, sessions, members/roles, rate limits, CSRF, public endpoints | `poultry-auth` (project skill) + `agent-skills:security-and-hardening` |
| Picking up the next task | `agent-skills:incremental-implementation` + `agent-skills:test-driven-development`, task from `tasks/todo.md` |
| UI screens (RTL, mobile, accessibility) | `agent-skills:frontend-ui-engineering`, then `web-design-guidelines` review |
| Browser checks / offline e2e | Playwright (`pnpm test:e2e`), built-in browser via `.claude/launch.json` (`web`) |
| Architecture decision | `agent-skills:documentation-and-adrs` → new ADR in `docs/decisions/` |
| Before merging a task | `/code-review`, `ponytail-review` (over-engineering), `agent-skills:code-reviewer` agent |
| T25 security + performance | `agent-skills:security-auditor` and `agent-skills:web-performance-auditor` agents, `/security-review` |
| Bugs | `agent-skills:debugging-and-error-recovery` |
