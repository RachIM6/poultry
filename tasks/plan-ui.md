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

### U14: Accounting settings (F-Profile)
- [x] `/settings/accounting` (owner, linked from "Plus" › Argent): the books, the chart (PCA or PCGE), the fiscal-year start and VAT registration (SPEC-finance FN1, FN9), saved through `finance.changeAccountingChoices`, now Zod-validated. Only the books the legal form allows are offered: companies and GIEs keep double-entry books (law 9-88), refused by the server too. Once the fiscal year has an entry the form is locked, with the reason shown. A cooperative sees that its chart isn't available yet (FQ2). (`e2e/accounting-settings.spec.ts`, fr and ar; `finance/ledger.int.test.ts`.)
- Not built from the mockup, since nothing stores them yet: associates and shares (ICE, IF, RC and CNSS since U17), the statements model, the stock valuation method, the layers method. The 5 M DH block links to `/threshold` instead of repeating it.

### U15: Chart of accounts (F-Chart)
- [x] `/settings/chart` (owner and manager, linked from "Plus" and from the accounting settings): each operation the app posts and its account in the agricultural chart and in the PCGE, the entity's own in bold. The rows come from the posting rules themselves (`POSTED_ACCOUNTS`, `EXPENSE_ACCOUNTS`), so the screen can't drift from what is posted; a test checks each has an account in both seeded charts. Account labels stay in French in both locales, as in the export. (`finance/domain/operations.test.ts`, `finance/accounts.test.ts`, `e2e/accounting-settings.spec.ts`.)
- Not built: the accountant editing a mapping (rules are code, ADR-010), the cooperative column (FQ2), analytic accounts, the Excel export of the plan; and the mockup's rows for operations the app doesn't post yet (salaries, egg trays).

### U16: Draft income statement (F-Statements, CPC)
- [x] `/books` gets a "Produits et charges" view for full-books entities: from the fiscal year's first day to the month shown, the CGNC sections 61/71 exploitation, 63/73 financier, 65/75 non courant and 67 impôts, each by 3-digit account, then the current, before-tax and net results. Computed from the trial balance (`finance/domain/statements.ts`), labelled a draft: the accountant closes the year. Account cells on `/books` now stay left to right in Arabic. (`finance/domain/statements.test.ts`, `e2e/books.spec.ts`.)
- Not built: the balance sheet and the ETIC (they need the CGNC's statement mapping, to take from the official model with the accountant), year-end inventories and depreciation, the PDF.

### U17: The last mockup gaps
- [x] `WebBatch`: on wide screens the batch page keeps the dark card and the strip on top, puts the growth chart beside the KPI tiles, and the lower sections (daily entry, weighings, vaccinations, treatments, costs) in two columns, sales across both. CSS only (`lg:`), so `/fr/batches`' first load doesn't grow; the phone is unchanged.
- [x] `WebSales`: receivables, cheques and a batch's sales read as tables on wide screens (one row per buyer, cheque or sale, columns shared by every row with CSS subgrid; receivables and cheques under a header row hidden from screen readers, since each cell names itself); cards on the phone.
- [x] Batch mockup's cost per kg tile on an open batch, for owners and managers (`money.read`): FN13's costs so far, read from the server as `/results` does (`/api/finance/batch-results`), ÷ (birds on hand × the latest average weight), half up (`flock` `liveCostPerKg`). "—" with the reason offline, before a weighing or before any cost. In the batch dashboard's lazy chunk.
- [x] F-Profile's ICE, IF, RC (number and court) and CNSS numbers on the legal entity (farm-registry, nullable columns): the owner edits them on `/settings/accounting`, never locked by the fiscal year; owners, managers and the accountant read them on the official statements' header; workers and vets never get them. Only the ICE's format is checked (15 digits; its check digits' algorithm isn't public); the others are free text, capped (IF 20, RC 20, court 60, CNSS 20): no official format found. Not in the FEC: CNC avis n° 24 fixes no file name or header, and the LPF's name uses a French Siren (docs/studies/accountant-import-format.md). (`farm-registry/legal-ids.int.test.ts`, `finance/entity-ids.int.test.ts`, `e2e/wide-screens.spec.ts`, `e2e/accounting-settings.spec.ts`.)

### After U17: guards and follow-ups (2026-11-24 and 25)
- [x] The a11y guard (`e2e/a11y.spec.ts`) also checks roles, hidden controls, 320 px reflow, WCAG 2.2 AA contrast and file-input labels; 14 buttons got `aria-expanded`, and the stepper and closing field edges were made visible (#273).
- [x] Dates in words on `/tasks` and `/staff`, a translated not-found page, a read-only accounting settings view for the accountant, wide screens checked in Arabic (#270).
- [x] Fixes from a dress rehearsal of the client demo: the daily entry starts on the feed used the day before, the empty state waits for the first pull, partners see « Voir la bande » (#279); the sign-in scope is remembered before the first page (#282).
- [x] Demo banner `DEMO_MODE=1` on every signed-in page (#265).

### U18: Cockpit home
- [x] From lg, the home follows the owner's chosen mockup « A · Cockpit » (`Main.dc.html`): a row of figures on top (yesterday's eggs, the live birds, the cash at hand, the tasks left), the open batches as rows (strip on light, status in colour, two or three figures inline) beside a rail with the day's checklist (withdrawals and missing days first, then one « Saisir » per house) and the « Argent » card. Same data as the phone (Dexie), the cash tile streamed in by the server with the money card's read (one `cache`d read). The figures and the order are pure (`components/today-cockpit.ts`, unit-tested); the wide parts are `hidden lg:…` in `components/today-wide.tsx`, the phone's `lg:hidden`, so the phone is unchanged and no hook reads the width. A figure with nothing behind it is left out (no eggs tile without a collection recorded yesterday; no tasks for the accountant; no cash for a worker). (`e2e/wide-screens.spec.ts`, `e2e/production-types.spec.ts`.)
- [x] Review fixes: the batch rows keep a 220 px name column (one line at 1 440 px, cut with a title beyond), the checklist names the house alone under « Saisies du jour », and the cash shows once on wide screens (the top tile; the « Argent » card drops that line there, and hides when it has nothing else).
- Exception to the Desktop rules' widths: from 2xl (1 536 px) the home alone grows to 1 600 px instead of the 1 152 px column, so on a 1 920 px screen the batches and their strips use the room. Every other page keeps `Page`'s widths.
- The new Arabic strings need a native speaker's review.

### Desktop rules (2026-11-25)
A 1 440 px audit found most signed-in pages hand-writing their width (`max-w-sm` … `max-w-4xl`), 23 of 40 using less than half of the content area beside the sidebar, and 15 putting the back link outside the centred column, far from its title. Every page converted from now on follows these rules; `/threshold` and `/sync` are the reference examples.
- **`Page`** (`src/components/page.tsx`) is the page's one container: `<Page width back title subtitle actions>`. It renders the back link above the h1, inside the column, then the children. No hand-written `<main>` or `<header><BackLink/></header>`. A page inside `ClientMessages` lists `"Nav"` when it has a back link. A title that needs data: the whole Page goes inside the Suspense, with `<Page width back />` as its fallback (`/threshold`).
- **Widths by page type**: forms and field entry `form` (576 px); lists, money and operations `wide` (576 px on the phone, 1 152 px from lg); printable documents `doc` (1 024 px from lg, full width on paper).
- **`split`** (`src/components/layout.ts`) for a form beside a list or a summary: `split` (two halves) or `splitNarrow` (a 360 px aside), `splitAside` to keep the aside in view. **`fields2`** puts a form's fields two by two from lg; long fields, fieldsets and buttons take `lg:col-span-full`.
- **Lists read as tables** from lg: `rowTable` + `rowHead` + `row` + `cell` (as on `/receivables`), each list giving its own `lg:grid-cols-[…]`.
- **No new client JS**: the layouts are CSS only (`lg:`). `layout.ts` stays out of `ui.ts`, which is in `/fr/batches`' first load (~8.5 KB left of 200 KB).
- **The phone stays as it was**: one column, the same order. The one change is the gap between a page's blocks, now `gap-5` everywhere (it was 3 to 6 depending on the page).
- **Logical properties only** (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`), so Arabic mirrors without `rtl:` overrides; grids mirror on their own.

### Later:, finance screens (`F-*`), settings and members. Arabic check with a native speaker before the pilot.
