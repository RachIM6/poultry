# Contributing

## Branches

| Branch | Purpose | Created from | Merged into |
|---|---|---|---|
| `main` | Integration branch. Always green. Never commit directly | — | — |
| `feat/t<N>-<slug>` | One task of `tasks/todo.md`, e.g. `feat/t5-otp-login` | `main` | `main` |
| `fix/<slug>` | Bug fix | `main` | `main` |
| `docs/<slug>`, `chore/<slug>`, `refactor/<slug>`, `test/<slug>`, `ci/<slug>` | Non-feature work, same prefix as the commit type | `main` | `main` |

- One task or one topic per branch. Keep branches short-lived.
- If `main` moved on, rebase before asking for review: `git pull --rebase origin main`.
- A branch that depends on an unmerged branch is created from that branch, and merged after it.
- A `develop` branch + staging environment will be added once hosting is chosen (ADR-007). Until then, `main` is the integration branch.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org): `type(scope): subject`, e.g. `feat(flock): daily entry with automatic feed consumption (T16)`.
- Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `perf`, `build`.
- Scope = a module id from `CAPABILITY-MAP.md` (`identity`, `flock`, `sales`…), or `sync`, `pwa`, `i18n`, `web`, `ci`.
- Subject in the imperative, 72 characters max. The body explains *why*, not what the diff already shows.
- One logical change per commit. Every commit builds and passes the tests.

## Pull requests

- Target `main`. Title = the main commit's subject.
- Description:
  - the task (`T#`) and the SPEC section;
  - what changed and why;
  - how it was tested (commands, manual checks, screenshots in **both `ar` and `fr`** for UI).
- Before opening: `pnpm lint && pnpm typecheck && pnpm test` must be green. Add `pnpm test:e2e` for UI or sync changes. CI must be green before merging.
- **Merge with a merge commit** (no squash). Task commits are already atomic and conventional, and stacked branches stay mergeable. Delete the branch after merging.
- Never force-push `main`. On your own branch, use `git push --force-with-lease` only.

## Architecture and security rules

- Domain and server code follow the `poultry-ddd` skill (`.claude/skills/poultry-ddd/`).
- Anything touching login, sessions, rate limits or public endpoints follows `poultry-auth`.
- The SPEC "Always / Ask first / Never" list applies to every change. In particular, **adding a dependency** and **changing the sync protocol** are "ask first".

## Never

- Commit `.env`, secrets, credentials, or real farm or personal data (ADR-007: synthetic data only until hosting + CNDP are settled).
- Merge with failing checks or unresolved review comments.
- Rewrite history that is already on `main`.
