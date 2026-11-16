# Plan: UI to the Dawra / DigiAtlas-VOLAILLE mockups

_2026-11-16. The app still had create-next-app's look. The user asked to move UI and features in parallel: this track restyles the app here; M2 compliance (T40–T49) and M3 (T50–T69) run in their own sessions and rebase onto U1 when it lands._

Source: the Design canvas https://claude.ai/artifact/HZgtMCvGPH4eJuKmf2nCLV (French screens; `Today`, `M1-*`, `WebOverview`, `WebBatch`, `WebSales`, `F-*`). Tokens: memory "design-direction" (Coquille, Poussin, Charbon, Ardoise, Olive, Brique, Alerte; Readex Pro; the 42-day strip). Light only, like the mockups.

Branches `feat/u<N>-<slug>`, stacked on the finance chain (first base: `feat/t38-export`).

### U1: Design system
- [x] Palette as Tailwind theme tokens, Readex Pro (Latin + Arabic) self-hosted with `next/font`, light only, theme colour Charbon.
- [x] Shared classes for fields, buttons, cards and notices (`src/components/ui.ts`), used by every form instead of each file's copy; no `green-700` left.

### U2: App shell
- [x] Phone: bottom tab bar Aujourd'hui · Lots · Stock · Plus (`Today.dc.html`). Wide screens: dark sidebar with the same entries plus the owner's (`WebOverview.dc.html`).
- [x] "Plus" lists the rest (finance, protocol, inbox, members, language, log out) by role.

### U3: Login, Aujourd'hui, daily entry
- [ ] Login and code screens as `M1-LoginPhone` / `M1-LoginCode`.
- [x] Aujourd'hui: dark header (date, farm, sync), one 42-day strip per open batch (done / missing / today / upcoming), today's tasks.
- [ ] Daily entry: steppers for deaths, culls, feed, water (`M1-DailyEntry`).

Done 2026-11-16 (branch `feat/u1-design-system`, U1 + U2 + the Aujourd'hui part of U3), decisions taken without asking:
- **Light only**, like every mockup: the old dark-mode colours are gone. Print stays black on white.
- **Readex Pro** for all text (Arabic + Latin), self-hosted by `next/font` (no request to Google from the phone).
- **Route group `(app)`** holds the signed-in screens, so URLs and the service worker's precached shells don't change. The tab bar is static (no role): what depends on the role is on `/more`.
- **Aujourd'hui** reads the phone's database (like /batches); the page around it stays online for the owner's 5 M DH alert. Making /dashboard itself an offline shell is still open.
- The sidebar on wide screens has the same four entries for now; the mockup's longer list (Santé, Ventes, Membres…) comes with those screens.
- `E2E_PORT` (default 3100) lets parallel sessions run Playwright on their own port.

### U4–U8 (next): batches and batch page, stock, sales and receivables, finance screens (`F-*`), settings and members. Arabic check with a native speaker before the pilot.
