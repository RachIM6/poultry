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

### U7: Finance screens
- [x] Books, budget, results, threshold, treasury and inbox: the old "←" header becomes the round back button to "Plus"; finance tables sit on white cards; the quick expense and the transfer forms are cards (`F-Expense`). Full browser suite: 44 passed.

Not yet: tables scroll sideways on a phone only inside the page; the mockup's receipt photo and "paid how" chips on the expense.

### U8: Farms, protocol, members
- [x] Farms, protocol and members get the round back button to "Plus"; members use the shared cards. Full browser suite: 44 passed.

Still open after U8: the sidebar's longer owner list on wide screens (role-dependent, so not in the static tab bar); an Arabic check by a native speaker.

### U9: Onboarding, offline, install
- [x] Onboarding (`M1-Onboarding`): the logo above, a large question, the legal forms as cards; offline page (`M1-Offline`): icon, heading and the way home at the bottom; install: the round back button. Full browser suite: 44 passed.

### U10: Aujourd'hui offline
- [x] `/today` is a static, precached twin of the home: it reads who is signed in (remembered by the last online visit) and the farm from the phone, like /batches. The service worker answers `/dashboard` with it when the network fails, so the tab and an installed app open the home offline. Online, `/dashboard` still renders on the server (the owner's 5 M DH alert, remembering who is signed in). (`e2e/today.spec.ts`.)
- [x] The batch page's header and day card load in the batch screen's second chunk: `/fr/batches` had gone 32 bytes over the 200 KB budget. It is now under it again, but close: the next addition to that page needs room made first.

### U11: The owner's "Argent" card
- [x] The online home shows, for owners and managers, the cash at hand and the last closed batch's cost per kg and margin (`WebOverview` "Argent"), linking to Trésorerie and Résultats. The offline twin shows no money.
- [x] PR #45 (next 16.4.6 and the dependency overrides) is merged into the chain: Next.js 16.4.3 had GHSA-mfr8-8qww-v76h (root params), and `next build` refused to start the test server. `pnpm audit`: no known vulnerabilities. Full browser suite: 45 passed.

### U12: The home on wide screens
- [x] `WebOverview` layout: on wide screens the tasks and the "Argent" card sit side by side, and the dark header is inset as its own card next to the sidebar. Full browser suite: 45 passed.

### U13: The owner's sidebar
- [x] On wide screens the sidebar also lists Ventes, Comptabilité and Membres (`WebOverview`), each only when the role signed in on this phone may use it (`can()`, the role read from the phone's database so the shell stays static; the server still checks every page). The phone's tab bar is unchanged. (`e2e/expenses.spec.ts`.) Full browser suite: 45 passed; `/fr/batches` still under the 200 KB budget.

### Later:, finance screens (`F-*`), settings and members. Arabic check with a native speaker before the pilot.
