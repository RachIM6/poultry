# Poultry

Offline-first PWA (Arabic / French) for managing Moroccan poultry farms, from chick placement to sale.

## Quick start

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm lint` | ESLint, including the module-boundary rule |
| `pnpm typecheck` | Next route types + `tsc --noEmit` |
| `pnpm test` | Vitest |
| `pnpm test:e2e` | Playwright (builds and starts the app; first run: `pnpm exec playwright install chromium`) |
| `pnpm build` | Production build |

## Docs

- [SPEC.md](SPEC.md): stack, conventions, boundaries, M1 requirements
- [CAPABILITY-MAP.md](CAPABILITY-MAP.md): modules and allowed dependencies
- [docs/decisions/](docs/decisions/): architecture decision records
- [tasks/](tasks/): current milestone plan
- Research: [BENCHMARK.md](BENCHMARK.md), [NEEDS-ANALYSIS.md](NEEDS-ANALYSIS.md), [SCOPE.md](SCOPE.md), [INTERVIEW-KIT.md](INTERVIEW-KIT.md)
