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

## Tooling installed for this project
- **Project plugins** (`.claude/settings.json`, shared through git):
  - `agent-skills` (spec / plan / build / test / review workflow);
  - `ponytail` (lazy-minimal code);
  - `security-guidance` (security warnings on edits);
  - `prisma` (MCP for migrations and SQL);
  - `context7` (up-to-date library docs);
  - `chrome-devtools-mcp` (live Chrome, performance traces);
  - `playwright` (browser automation MCP);
  - `frontend-design`.
- **Project MCP** (`.mcp.json`): `shadcn` (component registry). Approve it once when Claude Code asks.
- **Project skills** (`.claude/skills/`): `poultry-ddd`, `poultry-auth`, `poultry-pwa`.
- **User-level skills** (on Rachid's machine, not in this public repo because of their licences): `graphify`, `design-taste-frontend`, `image-to-code`, `playwright-cli`, `web-design-guidelines`.
- **Local mods** (`.claude/settings.local.json`, not committed): `cache-keeper`, `recording-mode`, `goal-meter`, `collision-guard`.

## Which skill / tool for which work
| Work | Use |
|---|---|
| Any domain or server code (modules, mutations, repositories, KPIs) | `poultry-ddd` (project skill) |
| Login, OTP, sessions, members/roles, rate limits, CSRF, public endpoints | `poultry-auth` (project skill) + `agent-skills:security-and-hardening` (`security-guidance` hooks run automatically) |
| Service worker, caching, manifest, install / offline pages, offline behaviour, PWA tests | `poultry-pwa` (project skill). Primary sources in its `references/sources.md` |
| Picking up the next task | `agent-skills:incremental-implementation` + `agent-skills:test-driven-development`, task from `tasks/todo.md`. `ponytail` keeps the diff minimal |
| Library APIs (Next 16, Prisma, next-intl, Serwist, Dexie, Zod) | `node_modules/next/dist/docs` for Next.js, **context7** for the rest. Never write library APIs from memory |
| Database schema, migrations, SQL checks | `prisma` plugin MCP + `poultry-ddd` (tenant column, integers, one owner per table) |
| UI screens (RTL, mobile, accessibility) | **shadcn MCP** for components, `agent-skills:frontend-ui-engineering`, `frontend-design` / `design-taste-frontend` for visual direction, `image-to-code` for mockups, then `web-design-guidelines` review |
| Browser checks / offline e2e | Playwright (`pnpm test:e2e`), `playwright` MCP or `playwright-cli`, built-in browser via `.claude/launch.json` (`web`), `chrome-devtools-mcp` for network and offline debugging |
| Understanding the codebase / docs as a graph | `/graphify` (writes `graphify-out/`) |
| Architecture decision | `agent-skills:documentation-and-adrs` → new ADR in `docs/decisions/` |
| Before merging a task | `/code-review`, `ponytail-review` (over-engineering), `agent-skills:code-reviewer` agent |
| T25 security + performance | `agent-skills:security-auditor` and `agent-skills:web-performance-auditor` agents, `/security-review`, `chrome-devtools-mcp` performance traces |
| Bugs | `agent-skills:debugging-and-error-recovery` |
