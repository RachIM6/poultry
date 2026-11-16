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
- [x] Login and code screens as `M1-LoginPhone` / `M1-LoginCode`.
- [x] Aujourd'hui: dark header (date, farm, sync), one 42-day strip per open batch (done / missing / today / upcoming), today's tasks.
- [x] Daily entry: steppers for deaths, culls, feed, water (`M1-DailyEntry`).

Done 2026-11-16 (branch `feat/u1-design-system`, U1 + U2 + the Aujourd'hui part of U3), decisions taken without asking:
- **Light only**, like every mockup: the old dark-mode colours are gone. Print stays black on white.
- **Readex Pro** for all text (Arabic + Latin), self-hosted by `next/font` (no request to Google from the phone).
- **Route group `(app)`** holds the signed-in screens, so URLs and the service worker's precached shells don't change. The tab bar is static (no role): what depends on the role is on `/more`.
- **Aujourd'hui** reads the phone's database (like /batches); the page around it stays online for the owner's 5 M DH alert. Making /dashboard itself an offline shell is still open.
- The sidebar on wide screens has the same four entries for now; the mockup's longer list (Santé, Ventes, Membres…) comes with those screens.
- `E2E_PORT` (default 3100) lets parallel sessions run Playwright on their own port.

Done 2026-11-16 (branch `feat/u3-login-daily-entry`): login with the big phone field and the button at the bottom; one code field (not 6 boxes: the phone's one-time-code autofill fills a single field). Daily entry: − / + steppers that can still be typed (deaths ±1, culls ±1, feed ±25 kg, water ±100 L), death causes as chips, the feed card says it is deducted from stock. The steppers' buttons are labelled "Moins 25" / "Plus 25", so a field's label still names only its input.

### U4: Batches and the batch page
- [x] Batch cards with the 42-day strip; the batch page as `Batch.dc.html`: round back button, a dark card with the day, birds, strip and next vaccine, the growth chart in a card above the KPI tiles.
- [x] The offline screens (batches, stock, farms, protocol, receivables, expenses) drop their old header: sync and language are under "Plus".

Done 2026-11-16 (branch `feat/u4-batch-page`). Not yet: the batch page's lower sections (weighing, vaccinations, treatments, sales, costs) only got the shared classes; the mockup's cost per kg tile.

### U5: Stock and the palette everywhere
- [x] Stock (`M1-Stock`): total value for managers, item cards with a "Bas" / "Suffisant" tag, the purchase as the main action.
- [x] Every screen: `opacity-75` and `border-current/*` become the palette's muted text and line colours; outlined boxes become white cards. Full browser suite: 44 passed.

### U6: Sales and receivables
- [x] Sale form (`M1-Sale`): buyer and weights in one card, price and payment in another, the weighing gap in brick, a dark summary with the amount.
- [x] Receivables: a dark "À encaisser" total first (`WebOverview`), shared cards. Section headings across the batch page share one style.

### U7–U8 (next):, finance screens (`F-*`), settings and members. Arabic check with a native speaker before the pilot.
