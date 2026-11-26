# Plan: UI cleanup of the signed-in screens

Audit of 2026-11-26 on `develop` (5aff51a), demo seed (`src/ops/demo`, « Ferme Démo Ben Ahmed » and « SARL Démo Avicole »),
production build, owner, 1 440 × 900 and 390 × 844. 68 full-page screenshots, one per route (`<route>.png`,
`sarl_<route>.png`, `phone_<route>.png`), are kept outside the repository with the audit notes; page heights below
are their measured scroll heights.

Scope: layout, density, hierarchy, buttons, grouping and navigation. Business rules, data, permissions, sync and
mutations stay as they are. Assumed done by the parallel header task: a top bar in the `(app)` layout with the bell,
the profile (full name, role), the language and the logout, and first and last names at sign-up. This plan does not
specify them again; it only says what it hangs on them (sync status, the bell's panel).

Read first: `tasks/plan-ui.md` "Desktop rules" (still in force: `Page`, widths, `split`, `fields2`, `rowTable`, logical
properties, phone unchanged unless this plan says so), `e2e/budget.spec.ts` (`/fr/batches` first load, 193.9 of
200 KB gzip).

## 1. What the audit found

Grounded in the screenshots, the code, the Vercel Web Interface Guidelines, the Impeccable audit and critique criteria
(Operate mode: scanability and consistency outrank expression) and agent-skills `frontend-ui-engineering`.

Health score (Impeccable audit scale, 0–4 each): accessibility 3, performance 3, theming 3, responsive 2,
implementation consistency 2. **13 / 20, "acceptable, significant work needed"**. The palette, focus rings, logical
properties and a11y guards are good; the weak part is that the phone sizes were carried to the wide screen unchanged.

Systemic issues (root causes: batch 0 builds the shared fix, the page batches apply it):

1. **[P1] Buttons stretch to their column.** `primary` and `secondary` (`src/components/ui.ts`) are `inline-flex`, but
   almost every form and section is `flex flex-col`, whose default `align-items: stretch` makes each button as wide as
   its column: « Comptabiliser les écritures de clôture » and « Clôturer l'exercice » are 992 × 56 px yellow bars, « Passer
   l'écriture » and « Calculer l'échéancier » 1 088 px, « Enregistrer le comptage » 992 px, « Enregistrer la journée »
   544 px, four « Saisir le jour » bars of 522 × 56 px on `/batches`. Measured in the page: 66 buttons or button-styled
   links at least 500 px wide across the 58 wide screenshots (notification cards left out).
2. **[P1] One size for thumbs and mice.** `field` is `min-h-12 text-lg`, `primary` `min-h-14 text-lg`, client-screen
   rows 68–77 px tall (`/eggs`, `/stock`, `/settings/chart`), while the server finance pages use `text-sm` rows of about 36 px.
   Two type scales side by side: `/receivables` and `/climate` read at 18 px, `/treasury` and `/closing` at 14 px.
3. **[P1] Everything on one page, every form open.** The batch page holds 8 sections and 2 forms (3 124 px tall at
   1 440 px, 4 979 px on the phone); `/treasury` 7 forms; `/staff` 3 forms; `/assets` and `/loans` print every depreciation and
   loan schedule in full (48 rows for one loan). No page uses tabs except the segmented « Cadavres / Fumier / Nuisibles »
   on `/disposal` (`biosecurity.tsx`, `aria-pressed`).
4. **[P1] Lists cut silently, no pagination.** Client lists `.slice(0, 20)` or `.slice(0, 10)` with no way to see older
   records (`expenses.tsx:89`, `biosecurity.tsx:310/436/688`, `climate.tsx:195`, `staff.tsx:344`); other lists render
   everything (`/prices` 51 rows, `/treasury/bank` 61 rows, `/eggs`, stock purchases, `/inspection` 20 462 px).
5. **[P2] Visible labels that repeat the record.** « Modifier « Assurance des bâtiments (démo) » », « Annuler la bande
   prévue le 8 décembre 2026 », « Arrêter « Contrôler les abreuvoirs et les pipettes » », « Modifier Saïd Démo »: the
   record's name belongs in the accessible name (`aria-label`, as `vaccinations.tsx` already does), not in a 400 px
   button. `/documents`, `/tasks`, `/planning`, `/staff`.
6. **[P2] Tables in four styles.** `table` (ui.ts, finance), `rowTable` (layout.ts), `cardRow` (layout-tight.ts), and
   hand-written bordered grids (`/closing/count`). Numeric columns left-aligned on `/closing/count` (« Selon les
   registres »). No sticky headers on long tables. On the phone, 9-column tables are crushed (`/treasury` « Mouvements du
   mois », the 4-week forecast cut at the edge).
7. **[P2] Navigation too long.** « Comptabilité de l'exercice » has 11 links and « Élevage » 10; at 900 px the last link
   (« Paramètres comptables ») is half hidden under « Replier le menu » with no scroll cue. Notifications and
   Synchronisation sit in « Élevage ». `/settings/posting` (« Remplacer un compte ») is in no menu at all.
8. **[P3] Back links inconsistent.** `/treasury/bank`, `/sync`, `/climate/targets`, `/settings/posting` show a back
   button on wide screens, `/treasury`, `/closing` and others do not; a back link to `/more` on a wide screen leads to a
   page the sidebar already replaces.

Page bugs found on the way (fix in the owning batch):
- **[P1] `/settings/members`**: the role `<select>` of each member collapses to 34 px and shows no value
  (`settings/members/forms.tsx:69`: `min-w-0 flex-1` beside three buttons); members show a phone number only (names
  come with the header task's sign-up change).
- **[P2] `/closing` for a « Livre des recettes et dépenses » entity**: the only content is a brick warning box; it is not
  an error. Show it as a neutral empty state.
- **[P2] `/settings/accounting`**: two unequal columns leave a 900 px hole beside the identity form; the « Plan de
  comptes / Remplacer un compte / Seuil d'exonération » links sit stranded at the bottom.

Not an app issue: date and time inputs show `mm/dd/yyyy` and `AM/PM` in the screenshots because headless Chromium
formats native date inputs in its own UI language.

## 2. Shared patterns (batch 0 builds them; every later batch uses them)

Tokens are those already in `src/app/[locale]/globals.css` (`@theme`): `shell`, `card`, `ink`, `ink-2`, `muted`, `line`,
`chick`, `chick-edge`, `chick-soft`, `chick-fg`, `olive`/`olive-soft`, `brick`/`brick-soft`/`brick-fg`,
`alert`/`alert-soft`/`alert-fg`; card radius `rounded-[18px]`, control radius `rounded-2xl` (phone) / `rounded-xl`.
No new colour token. Every rule below changes the wide screen (`lg:`) and leaves the phone as it is, unless stated.

### 2.1 Page header (`src/components/page.tsx`, extended, not replaced)
- Row 1: back link (detail pages only, see below). Row 2: `h1` `text-2xl font-semibold` + subtitle `text-sm text-ink-2`
  on the start side; `actions` on the end side, **small buttons only** (`primarySm`, `secondarySm`, `ghost`), at most one
  primary. Row 3 (optional): the period stepper and the tabs, full width.
- New `PeriodNav` (server-safe, in `page.tsx` or `period-nav.tsx`): the « ← 2026 → » / « ← novembre 2026 → » stepper now
  hand-written four times (`books`, `closing`, `closing/count`, `closing/statements`), with its `aria-label`s and
  `rtl:-scale-x-100`.
- Back link: kept for detail pages (a batch, `/report`, `/settings/posting`, `/climate/targets` until it becomes a tab).
  `back="/more"` renders `lg:hidden` (the sidebar replaces « Plus » on wide screens). Long explanations under the title
  (`/closing`, `/assets`, `/loans`, `/settings/chart`) go into one `text-sm text-ink-2 max-w-prose` paragraph or a
  `<details>` « Comment c'est calculé », not three paragraphs above the content.

### 2.2 Buttons (`src/components/ui.ts`)
| Name | Phone (unchanged) | From `lg` | Use |
|---|---|---|---|
| `primary` (md) | `min-h-14 text-lg px-5 rounded-2xl` | `lg:min-h-10 lg:px-4 lg:text-base lg:rounded-xl lg:w-fit` | the one main action of a form or page |
| `secondary` (md) | `min-h-11 px-4 rounded-xl` | `lg:min-h-9 lg:px-3 lg:text-sm lg:w-fit` | other actions, openers |
| `primarySm` (new) | `min-h-11 px-4 text-base rounded-xl` + primary colours | `lg:min-h-8 lg:px-3 lg:text-sm` | header actions, row actions |
| `secondarySm` (new) | `min-h-11 px-3 rounded-xl border border-line bg-card` | `lg:min-h-8 lg:text-sm` | row actions (« Payer », « Pointer », « Modifier ») |
| `ghost` (new) | `min-h-11 px-2 rounded-lg text-ink-2` | `lg:min-h-8`, `hover:bg-shell hover:text-ink` | tertiary, « Annuler » in a form |
- `lg:w-fit` is the fix for systemic issue 1: an explicit width beats `align-items: stretch`, and it is harmless in rows
  and grids. Do not use `self-start` (it top-aligns buttons in rows).
- Every button gets a hover state (guidelines): primary `hover:brightness-95`, secondary `hover:border-muted
  hover:bg-shell`. Disabled stays `disabled:opacity-60`.
- **Full width is allowed only for a form's submit on the phone** (below `lg`), and never for an opener (« Ajouter … »)
  or a section action. Two primaries on one screen are not allowed: « Comptabiliser les écritures de clôture » is the
  primary, « Clôturer l'exercice » becomes a secondary in a closing step of its own (§5).
- `formActions` (layout.ts, new): `flex flex-wrap items-center gap-3 lg:col-span-full` at the end of a form, submit
  first, « Annuler » as `ghost`.
- `field` gains `lg:min-h-10 lg:text-base lg:rounded-xl lg:px-3` (phone unchanged). Selects that choose a farm or a
  house are `lg:max-w-xs`, not full width (`/tasks`, `/cleanout` stretch a farm select to 1 120 px).
- Bytes: ui.ts is in `/batches`' first load; the new strings add well under 0.5 KB gzip. Measure with
  `pnpm test:e2e e2e/budget.spec.ts`.

### 2.3 Section cards
- A section is `<section aria-labelledby>`: a header row (`h2` `text-lg font-semibold text-ink`, optional count
  `text-sm text-ink-2`, actions `secondarySm` on the end side), then one `card` holding the content. One heading style
  (today: grey `text-ink-2` headings on `/receivables`, `/eggs`, black on others).
- Gap between sections `gap-5` (Desktop rules), inside a card `gap-2`/`gap-3`. No card inside a card (the `/assets` and
  `/loans` disclosures are bordered boxes inside cards).

### 2.4 Tabs (`src/components/tabs.tsx`, new, server-safe, no `"use client"`)
- **Links, not a `role="tablist"`**: each tab is a `<Link>` with `aria-current="page"` inside `<nav aria-label>`. Back
  and forward work, a tab can be linked and opened in a new tab, no JS, and it matches the `/disposal` decision ("not a
  half tablist"). Look: `flex gap-1 overflow-x-auto border-b border-line`; tab `min-h-11 px-3 text-sm font-medium
  text-ink-2 hover:text-ink`; current `border-b-2 border-ink text-ink font-semibold`; optional count badge
  `rounded-full bg-shell px-2 text-xs`. Scrolls sideways on the phone instead of wrapping.
- Two uses, one component:
  - **Query tabs** `?tab=<key>` within one page. Server pages read `searchParams` (already inside `Suspense`, as
    `/books`); client screens read the query on the client (`useSearchParams` under a `Suspense`, or the
    `useSyncExternalStore` pattern `batches.tsx` uses for the hash). Unknown or missing key → the first tab. Links use
    `scroll={false}`.
  - **Route tabs**: links between sibling routes that become one section (§3). URLs do not change, so no redirect, no
    service-worker precache change, no e2e URL change. The tabs carry the shared query (`?year=` on the closing tabs).
- Documents (`/closing/statements`, `/inspection`): all panels are rendered, the inactive ones `hidden print:block`, so
  « Imprimer » still prints the whole document.
- Service worker: the precached shells are matched by URL; `?tab=` and `?page=` must not miss the precache offline. Add
  them to the precache's ignored URL parameters in `src/sw.ts` (Serwist precache option `ignoreURLParametersMatching`;
  confirm the option name in the Serwist 9 docs before writing it) and add an offline e2e check on `/fr/batches?tab=…`.

### 2.5 Pagination (`src/components/pager.tsx` + pure `pager.ts`, new)
- `pageWindow(current, pageCount)` (pure, unit-tested): `1 … 4 5 6 … 12`. The component renders « 26–50 sur 132 », « ‹
  Précédent », the numbers, « Suivant › », as links (`?page=`), `aria-label="Pagination"`, `aria-current="page"` on the
  current number, targets `min-h-11 lg:min-h-8`. Page size 25 rows for tables, 20 for card lists.
- **Server pages**: `?page=`, total from the same read. Where the read already returns everything for a bounded period
  (a month of `/books`, a statement of `/treasury/bank`), slice on the page:
  `shortcut: in-memory page slice, move to skip/take in the module read when a period passes ~1 000 lines`.
- **Client (Dexie) lists**: the same component and the same `?page=` links (client navigation to the same shell,
  works offline with §2.4's precache rule). Replace every silent `.slice(0, N)` (systemic issue 4) by sort + pager.
- **Filter before paging** where people look for one thing: `/treasury/bank` « À pointer (n) / Toutes » (default « À
  pointer »), `/prices` product chips, stock purchases by article, `/inbox` « Non lues / Toutes », `/settings/chart`
  grouped by class with sticky class headers (33 lines: no pager). Filters are query tabs (§2.4).

### 2.6 Tables (`layout.ts`, new `dataTable` and `num`; not in ui.ts, to spare `/batches`)
- Real `<table>` for tabular data. `dataTable`: `w-full text-sm`, cells `px-3 py-2`, rows `border-t border-line`,
  `th` `text-start font-medium text-ink-2 bg-shell`, sticky header from `lg` (`lg:[&_th]:sticky lg:[&_th]:top-0`; the
  wrapper is `overflow-x-auto lg:overflow-visible`, since a scroll container breaks sticky). Row height ~40 px on wide
  screens (now 68–77 px on client lists).
- `num`: `text-end tabular-nums whitespace-nowrap` for every amount, quantity, weight and percentage column, header
  included.
- Row actions: one action → a `secondarySm` or a text `link` at the row's end; two or more → the most likely one as a
  button plus a « ⋯ » menu (`<details>` + absolutely positioned panel, `disclosure` summary). Receivables' cheque rows
  (« Remis à la banque », « Encaissé », « Impayé ») and `/documents` (« Ajouter le fichier », « Modifier ») use it.
- Phone: tables with more than 4 columns become `rowTable` rows (cards), as `/receivables` already does. Merge
  `layout-tight.ts`'s `cardRow` into this rule only when its pages are touched; do not refactor it for its own sake.

### 2.7 Forms: inline or in a sheet (`src/components/sheet.tsx`, new, `"use client"`)
- **Inline** when the form is the page's repeated job: daily entry, weighing, climate reading, visitor entry, dépense
  rapide, prix du marché, comptage. Shown open, one per view.
- **Sheet** when the form is occasional or not what the page is for: « Apport ou retrait », « Payer », « Ajouter un
  traitement / une visite / un vaccin », « Nouvelle vente », « Ajouter un ouvrier », avance, formation et accident,
  « Ajouter une immobilisation / un emprunt / une subvention », « Ajouter un relevé », « Importer un relevé »,
  « Inviter un membre », « Saisir le vide sanitaire minimum », « Ajouter une tâche régulière », « Ajouter un document »,
  « Ajouter une ferme / un bâtiment ». Modal first is not the rule (Impeccable): only these.
- Native `<dialog>` + `showModal()` in an effect: side sheet from `lg` (`fixed inset-y-0 end-0 m-0 ms-auto h-dvh
  w-[28rem] max-w-full rounded-s-[18px]`), bottom sheet on the phone (`mt-auto w-full max-h-[90dvh]
  rounded-t-[18px]`), `backdrop:bg-ink/40`, `overscroll-behavior: contain`, header with the `h2` title and a close
  button (`aria-label` « Fermer »), Escape and the close button call `onClose`. Built on `useInline` (`focus.ts`), which
  already returns focus to the opener. Server-action forms (treasury, assets, loans) are passed as server-rendered
  children of a small client `SheetButton`; the form closes the sheet on success.
- In `/batches` the sheet loads with the lazy section chunks, never in the first load.
- No dependency: Radix/shadcn Dialog would add a focus-trap and portal stack for what `<dialog>` does natively.

### 2.8 Empty states (`layout.ts`, new `empty`)
- `rounded-[18px] border border-dashed border-line p-6 text-center text-sm text-ink-2` + one sentence saying what will
  appear here and how, + at most one `secondarySm` action. Replaces bare « Aucune vente. », « Rien à passer pour cet
  exercice. » boxes, the `/closing` brick box for cash-basis entities, and the 7 empty templates of `/protocol` (§5).

### 2.9 « Payer » rows (treasury and stock)
- Today: each payable is a card with « Reste dû » and a bordered `<details>` box « Payer ▾ » 56–70 px tall
  (`treasury/page.tsx:74`, `pay-form.tsx`, supplier rows in `stock.tsx`).
- After: one « À payer » table (Fournisseur · objet, Bande ou date, Échéance, Reste dû `num`, action), the chick and
  pullet suppliers and the credit expenses together, sorted by due date, a type column instead of two sections. The row
  action « Payer » (`secondarySm`) opens the sheet with the existing pay form, amount prefilled with the remainder. The
  form, its action and its validation are moved, not rewritten.

### 2.10 Component decisions

| Pattern | Decision | Why |
|---|---|---|
| Page header, `PeriodNav` | in-house, extend `page.tsx` | exists; server-safe |
| Buttons, fields | in-house, `ui.ts` strings | root-cause fix in one file, < 0.5 KB |
| Tabs | in-house links (`tabs.tsx`), no JS | URL state for free, no tablist ARIA to get wrong |
| Pagination | in-house links (`pager.tsx`, `pager.ts`) | ~40 lines; same for server and Dexie lists |
| Tables | in-house class strings (`layout.ts`) | three systems exist already; converge, don't add a fourth |
| Sheet / dialog | in-house native `<dialog>` (`sheet.tsx`, client) | focus, Escape, inert background are native; ~1 KB |
| Row « ⋯ » menu | in-house `<details>` | no JS, works with the `disclosure` utility |
| Toasts | none | out of scope; forms already confirm inline |

No dependency is added. Considered and rejected: shadcn/ui on Radix (the repo has no shadcn setup and the shadcn
connector is unavailable; each primitive brings Radix runtime into a 6 KB-margin first load), `nuqs` (Next's
`searchParams` and `<Link>` cover it), TanStack Table (no sorting or virtualisation need once lists are paged).
Because none is added, no version was vetted; if a later batch wants one, it vets the latest stable release first
(project rule).

## 3. Navigation and grouping

Principle: merge by **route tabs** (§2.4), so every URL keeps working. No page disappears and **no redirect is
needed**: `/sync` stays (offline fallback, refused writes), `/inbox` stays (push notifications open it), `/today` stays
(the PWA's `start_url` and offline home), `/more` stays (the phone's menu). This avoids touching the service worker's
precache list, push payload URLs and ~40 e2e `goto`s. A redirect would only be added if a later decision deletes a URL.

| Today | After | What moves | Links and tests that change |
|---|---|---|---|
| « Notifications » in Élevage | the header bell opens a panel: 5 latest unread, « Tout marquer lu », « Toutes les notifications » → `/inbox`. `/inbox` leaves the sidebar; on the phone it moves to « Compte » in `/more`. `/inbox` gets « Non lues / Toutes » tabs + pager; « Notifications sur ce téléphone » and « Heures calmes » become a « Réglages » query tab | panel component in the header (after the header task lands) | `more-groups.ts`; `inbox.spec.ts`, `climate-alert.spec.ts` (reach /inbox by URL, unchanged); `sidebar.spec.ts` link counts |
| « Synchronisation » in Élevage | header status chip (SyncBadge: « Tout est envoyé » / « 3 en attente » / « Hors ligne »), links to `/sync`; « Synchroniser maintenant » becomes a `secondarySm` in `/sync`'s card. `/sync` leaves the sidebar; on the phone it moves to « Compte » | SyncBadge from the home header (`today.tsx`) into the header bar | `today.tsx`, header file; `sync.spec.ts` (URL unchanged), `today.spec.ts`, `wide-screens.spec.ts` (badge position) |
| « Plus » page on wide screens | not linked on wide screens; sidebar's « Langue et déconnexion » (→ `/more`) removed from `lg` once the header has language and logout. Phone unchanged | — | `sidebar.spec.ts` |
| Paramètres comptables, Plan de comptes, Remplacer un compte (3 pages, the last in no menu) | one sidebar entry « Paramètres comptables » with route tabs **Profil** (`/settings/accounting`) · **Plan de comptes** (`/settings/chart`) · **Comptes remplacés** (`/settings/posting`) | the bottom links card of `/settings/accounting` goes; « Seuil d'exonération » link goes (it has its own tab, below) | `more-groups.ts`; `accounting-settings.spec.ts` |
| Résultats des bandes, Budget d'une bande, Seuil d'exonération | one entry « Résultats et budget » with route tabs **Résultats** (`/results`) · **Budget** (`/budget`) · **Seuil d'exonération** (`/threshold`) | — | `budget*.spec.ts`, `threshold.spec.ts`, `report.spec.ts` (URLs unchanged) |
| Inventaire de fin d'exercice, Préparer la clôture, États de synthèse | one entry « Clôture de l'exercice » with route tabs as numbered steps **1 Inventaire** (`/closing/count`) · **2 Écritures de clôture** (`/closing`) · **3 États de synthèse** (`/closing/statements`), sharing `?year=` | the « Inventaire de fin d'exercice » link on `/closing` goes | close specs (URLs unchanged); `sidebar.spec.ts` (`/closing/count` is used there) |
| Trésorerie, Rapprochement bancaire | one entry « Trésorerie » with route tabs **Vue d'ensemble** (`/treasury`) · **Rapprochement** (`/treasury/bank`) | the « Rapprochement bancaire » link inside `/treasury` and the back button of `/treasury/bank` go | `bank.spec.ts`, `treasury.spec.ts` |
| Climat des bâtiments, Cibles de climat | `/climate` with route tabs **Relevés** · **Cibles** (`/climate/targets`) | the « Cibles de climat » link and the back button go | `climate*.spec.ts` |
| Tâches du jour (page) vs the home's « Tâches du jour » | keep both; the home rail's heading gets « Tout voir » → `/tasks`, the « Tâches restantes » tile links to `/tasks` | — | `today-wide.tsx`; `wide-screens.spec.ts` |
| `/today` vs `/dashboard` | unchanged (offline twin) | — | — |

Sidebar after (owner): Élevage 8 (Fermes et bâtiments, Stock d'œufs, Comparer les bandes, Programme de vaccination,
Tâches du jour, Climat, Planning, Personnel); Argent 5 → 4 (Créances, Dépense rapide, Trésorerie, Prix du marché);
Comptabilité 11 → 6 (Livres comptables, Résultats et budget, Clôture de l'exercice, Immobilisations, Emprunts et
subventions, Paramètres comptables); Conformité 5; Compte 2 (+ Notifications and Synchronisation on the phone's
`/more`). 34 links in the sidebar groups → 25. The active state of a merged entry covers all its routes (`isIn` in `app-nav-live.tsx`).

Option left to the owner, not in the batches: the cash-basis entity (« Livre des recettes et dépenses ») sees steps 2
and 3 of the closing with nothing to do. Safe default in this plan: keep the tabs and show a neutral empty state that
says why; hiding them is a later decision.

## 4. Page by page

Size: S ≤ ½ day, M ≈ 1 day, L ≥ 2 days. "Shared" = only the batch 0 fixes apply (sizes, `lg:w-fit`, header), no page
work. Height = full-page height at 1 440 px.

| Route | Seen (height) | Fix | Size | Files |
|---|---|---|---|---|
| `/dashboard` | good cockpit; 4 « Saisir » yellow 48 px buttons in the rail, sync pill in the title row (958) | `primarySm` for « Saisir »; badge moves to header (§3); « Tout voir » → /tasks | S | `today-wide.tsx`, `today.tsx`, `dashboard/page.tsx` |
| `/today` | same screen, offline twin (900) | follows `/dashboard` | — | `today.tsx` |
| `/batches` (list) | 4 full-width 522 × 56 « Saisir le jour » bars; open and closed batches mixed (1 042) | query tabs « En cours (4) / Clôturées (3) »; « Saisir le jour » `primarySm`; closed rows as a compact table with « Voir le bilan » | M | `batches.tsx` |
| `/batches#<id>` (batch page) | 8 sections on one scroll: strip, alerts, indicators, daily entry, weighing, vaccinations, treatments, vet visits, diseases, sales, closing actions; 12 full-width outline buttons; « Clôturer la bande » sits under « Corriger la mise en place » (3 124; phone 4 979) | keep the dark strip card and alerts above the tabs; query tabs **Saisie** (daily entry + weighing, default) · **Indicateurs** (chart, KPI tiles, notes, costs) · **Santé** (vaccinations, treatments, visits, notifiable diseases) · **Ventes** (sales, link to Dépense rapide) · **Bande** (registers and report links, correct placement, transfer, close). Header actions: « Rapport de bande », registers in a « ⋯ » menu. « Ajouter un vaccin / un traitement / une visite », « Nouvelle vente », « Clôturer la bande » open sheets; « Marquer comme fait / Changer le jour / Retirer du plan » become a primary-sm + « ⋯ ». Closed batch: tabs Bilan · Santé · Ventes. Each tab mounts only its lazy chunks | L | `batches.tsx`, `batch-dashboard.tsx`, `daily-entry.tsx`, `weighing.tsx`, `vaccinations.tsx`, `treatments.tsx`, `sales.tsx`, `closing.tsx`, `correct-placement.tsx`, `notifiable-diseases.tsx`, `register-links.tsx`, `eggs.tsx`, `layer-dashboard.tsx`, `turkey-sexes.tsx`, `placement.tsx`, `reopen-batch.tsx` |
| `/report` | printable; empty without `?batch` (900) | shared | S | `batch-report.tsx` |
| `/more` | wide: duplicate of the sidebar, 2 524 px of links (phone fine) | not linked on wide (§3); phone: Notifications and Sync under « Compte » | S | `more/page.tsx`, `more-groups.ts` |
| `/farms` | fine split; « Modifier » buttons 44 px in rows (900) | `secondarySm`; « Ajouter une ferme / un bâtiment » sheets | S | `farms.tsx` |
| `/eggs` | rows 77 px; collections oldest first; « Vendre des œufs » 56 px yellow under the count (1 782) | `dataTable`, newest first, pager 25; « Vendre des œufs » `primarySm` in header actions, sale form in a sheet | M | `egg-stock.tsx`, `egg-sale.tsx` |
| `/compare` | clean (900) | shared | S | `compare.tsx` |
| `/protocol` | 7 identical template cards (« Pas encore vérifié… », « Ce modèle ne contient encore aucun vaccin », « Copier pour mon exploitation ») fill the page; the farm's own programme is a side column with 44 px « Retirer » buttons and a 56 px yellow « Ajouter un vaccin » (974) | own programme first, full width, as a `dataTable` (Jour, Vaccin, Voie, action « Retirer » ghost/⋯); « Ajouter un vaccin » `secondarySm` in the section header, sheet. Templates in one compact list « Modèles de référence » (name, « non vérifié » badge, « Copier » link) or a `<details>`; empty templates say so once | M | `protocol.tsx` |
| `/tasks` | farm select 1 120 px wide; each of 5 tasks has a full-width assignee select; « Ajouter une tâche » form open; « Modifier « … » » and « Arrêter « … » » 400 px buttons (1 385) | farm select `lg:max-w-xs`; today's list as rows with a compact assignee select; « Ajouter une tâche » and « Ajouter une tâche régulière » sheets; recurring tasks as a table with ⋯ menu; short visible labels | M | `tasks.tsx` |
| `/climate` | form + history split is OK; « Coupure de courant » as a 56 px bordered brick bar; history cut to 10 with no access to older (900) | route tabs Relevés · Cibles; « Coupure de courant » `secondarySm` (brick text) opening a sheet; history pager | M | `climate.tsx` |
| `/climate/targets` | a 544 px column with one card and a 56 px « Saisir les cibles » (900) | becomes the Cibles tab; `wide` width; targets as a table; « Saisir les cibles » `primarySm`, form in a sheet | S | `climate-targets.tsx`, `climate/targets/page.tsx` |
| `/planning` | big always-open form beside the list; second rule form behind « Saisir le vide sanitaire minimum »; « Modifier / Annuler la bande prévue le 8 décembre 2026 » 380 px buttons (1 166) | list full width as a table per farm (Bâtiment, État, Prévu le, Poussins, Couvoir, Vente vers, actions); « Planifier une bande » `primarySm` in header → sheet; rule → sheet; short labels with aria-labels | M | `planning.tsx` |
| `/staff` | 4 sections, 3 forms open (presence, advance, training), 2 219 px; « Modifier Saïd Démo » buttons | query tabs **Équipe** · **Présence** · **Avances** · **Formations et accidents** · **Paie**; forms in sheets except the presence entry (inline, it is that tab's job); short labels | L | `staff.tsx` |
| `/inbox` | each notification a 102 px full-width button; settings column (900) | tabs Non lues / Toutes / Réglages, dense list rows, pager; bell panel (§3) | M | `inbox.tsx`, `inbox/page.tsx` |
| `/sync` | one card and a 544 × 56 yellow button in a 576 px column (900) | header chip (§3); `secondarySm` « Synchroniser maintenant » inside the card; refused writes listed as a table | S | `sync-status.tsx`, `sync/page.tsx` |
| `/stock` | good table; « Enregistrer un achat » 360 × 56 in a side column; purchases unbounded; suppliers with « Payer Provende Démo du Centre » 44 px and « Débité » buttons (2 021) | header actions: « Enregistrer un achat » `primarySm`, « Corriger le stock », « Ajouter un article » `secondarySm` (all sheets); query tabs **Articles** · **Achats** (filter by article, pager) · **Fournisseurs** (« Payer » → sheet, §2.9) | M | `stock.tsx` |
| `/receivables` | 3 buttons per cheque row; two separate tables for buyers and credit limits (1 643) | cheque row: next-state button + ⋯; buyers table gains a « Plafond » column with « Modifier » (sheet), the « Plafonds de crédit » section goes; « Enregistrer un paiement » `secondarySm` → sheet | M | `receivables.tsx` |
| `/expenses` | good split; list silently capped at 20 (1 057) | pager (removes the cap); « Ajouter une caisse ou un compte » sheet | S | `expenses.tsx` |
| `/treasury` | 3 763 px: balances, 4-week forecast, 4 + 2 « Payer » boxes, an always-open « Apport ou retrait » form, then a 9-column movements table that wraps « Caisse de la ferme » on 3 lines; no back, no actions; phone tables cut | route tabs Vue d'ensemble · Rapprochement; header actions « Apport ou retrait » `secondarySm` → sheet; top row: balances + 4-week forecast side by side; « À payer » table (§2.9); « Mouvements du mois » with `PeriodNav`, `dataTable` (journal code as a badge, account names short), pager; phone: rowTable | L | `treasury/page.tsx`, `treasury/pay-form.tsx`, `treasury/actions.ts` (untouched logic) |
| `/treasury/bank` | 4 311 px: two 30-row lists (statement lines and book lines) one under the other, « Ajouter un relevé » and file import forms always open, back button | Rapprochement tab; summary card (solde relevé, solde comptable, pointé, écart) on top; filter tabs « À pointer (n) / Toutes »; statement lines and book lines side by side from `lg`, each paged; « Ajouter un relevé » and « Importer un relevé » header actions → sheets; « Pointer / Dépointer » `secondarySm` | L | `treasury/bank/page.tsx`, `treasury/bank/forms.tsx` |
| `/prices` | « Derniers prix » card good; history 51 rows (2 340) | product filter chips + pager; form stays inline (it is the page's job) with `lg:w-fit` submit | S | `prices.tsx` |
| `/books` | « Période » card with 44 px « Clôturer le mois »; « Écriture manuelle » 1 088 px wide disclosure; long month list (2 028) | header: `PeriodNav`, « Exporter » ghost, « Écriture manuelle » `secondarySm` → sheet; period status as a badge with « Clôturer le mois » `secondarySm`; `dataTable` sticky, pager 50 | M | `books/page.tsx`, `books/form.tsx` |
| `/results` | clean table, « Détail » disclosures (900) | `num` columns; tab bar (Résultats et budget) | S | `results/page.tsx`, `results/form.tsx` |
| `/budget` | inputs at text-lg, 56 px save; saved budgets as cards with disclosures (1 234) | `fields2` stays, compact fields from batch 0; saved budgets as a table with « Voir » → `<details>` row; tab bar | S | `budget/page.tsx`, `budget.tsx`, `budget-cash.tsx` |
| `/threshold` | fine, mostly empty (900) | tab bar only | S | `threshold/page.tsx` |
| `/closing/count` | bordered grid tables, quantities left-aligned, 44 px inputs, a 992 px « Enregistrer le comptage » (1 754) | step 1 tab; `dataTable` with `num` and compact inputs (`lg:w-32`); sticky submit bar at the bottom of the form (`primary`, w-fit) | M | `closing/count/page.tsx`, `closing/count/form.tsx` |
| `/closing` | SARL: 7 sections, long explanation paragraphs, two « Enregistrer les valeurs actuelles » 960 px, two 992 × 56 yellow bars (2 535); individual: one brick warning (900) | step 2 tab; per section a compact card (title, status badge « À comptabiliser / Rien à passer », entries table), explanations in « Comment c'est calculé » `<details>`; empty sections collapse into one line; « Comptabiliser les écritures de clôture » = the one primary, bottom of page, w-fit; « Clôturer l'exercice » = `secondary` inside a final « Clôturer l'exercice » card with its condition sentence; cash-basis entity: neutral empty state | M | `closing/page.tsx`, `closing/form.tsx` |
| `/closing/statements` | 5 868 px single scroll: bilan actif, passif, CPC, ETIC tables (SARL) | step 3 tab; query tabs **Bilan** · **Compte de produits et charges** · **État des informations complémentaires**, all rendered, `hidden print:block`; « Imprimer » ghost in header; hide all-zero lines behind « Afficher les lignes vides » (`?empty=1`) | M | `closing/statements/page.tsx`, `entity-header.tsx` |
| `/assets` | 3 264 px: every asset prints its full schedule (up to 21 rows) plus two disclosures; « Ajouter une immobilisation » disclosure 1 088 px wide | assets `dataTable` (Désignation, Compte, Mise en service, Coût, Amort. cumulés, VNC, ⋯); « Plan d'amortissement » in a row `<details>` or sheet; « Modifier la durée… » and « Céder… » in the ⋯ menu → sheets; « Ajouter une immobilisation » header action → sheet | M | `assets/page.tsx`, `assets/form.tsx` |
| `/loans` | 3 054 px: a 48-row schedule open, subsidies schedule open | loans and subsidies as tabs; per loan a summary row (capital restant dû, prochaine échéance, taux); schedule in a sheet or `<details>` showing the next 6 rows with « Tout afficher »; « Ajouter un emprunt / une subvention » header actions → sheets | M | `loans/page.tsx`, `loans/form.tsx` |
| `/settings/accounting` | unequal columns, 900 px hole, links card stranded at the bottom (1 888) | Profil tab; one column of setting cards: Identité (form in a sheet or inline compact), Tenue, Plan, Exercice, TVA, Poules, Répartition; locked notice as one `warn` line on top; bottom links card removed (tabs replace it) | M | `settings/accounting/page.tsx`, `form.tsx`, `ids-form.tsx` |
| `/settings/chart` | 33 rows, three columns, text-lg rows 52 px (2 180) | Plan de comptes tab; grouped by class (Charges, Produits, Tiers, Trésorerie, Capitaux) with sticky group headers, dense `dataTable`, the entity's chart column first, the other muted | S | `settings/chart/page.tsx` |
| `/settings/posting` | not in any menu; form beside the table (1 335) | Comptes remplacés tab; « Remplacer » per row → sheet instead of the side form | S | `settings/posting/page.tsx`, `form.tsx` |
| `/visitors` | long always-open form, list of today on the side (904) | keep inline (page's job); fields compact, `fields2`; checkboxes in a fieldset grid; today's visits as table + pager for older | S | `biosecurity.tsx` (Visitors) |
| `/disposal` | segmented tabs good; 14-day table without card (900) | segmented control → query tabs (same look as §2.4, links); table in a card; recent eliminations pager (removes the 20 cap) | S | `biosecurity.tsx` (Disposal) |
| `/cleanout` | 1 120 px farm select; checklist rows OK (900) | farm select `lg:max-w-xs`; « Noter / Modifier » `secondarySm` → sheet | S | `biosecurity.tsx` (Cleanout) |
| `/documents` | 3 columns crushed (« Ferme Démo Ben Ahmed » on 3 lines); « Modifier « Assurance… » » buttons; « Ajouter un document » alone in a side column (1 531) | full-width `dataTable` (Document, Catégorie, Ferme, Échéance, État badge, ⋯ with « Ajouter le fichier » / « Modifier »); « Ajouter un document » header action → sheet; short labels | M | `documents.tsx` |
| `/inspection` | a 20 462 px printable dossier, 62 headings (document) | on-screen table of contents (anchor links, sticky aside from `lg`) or query tabs by part, all rendered for print; « Imprimer » header action | M | `inspection.tsx`, `register-document.tsx` |
| `/settings/members` | role select collapsed to 34 px with no visible value (bug); three 44 px buttons per row; invite form beside (900) | fix the select width (`min-w-40`); row: role select + « Enregistrer » only when changed, « Retirer » and « Réinitialiser le mot de passe » in ⋯; « Inviter un membre » header action → sheet; show names when the header task adds them | M | `settings/members/page.tsx`, `forms.tsx` |
| `/organizations` | narrow form page, fine (900) | shared | S | `organizations/page.tsx`, `join-code-form.tsx` |

## 5. Batches

Ownership rule: a batch edits only the files it owns. Anything else (a shared component, a message used by two batches)
goes to batch 0, or is asked for. Each batch uses the shared patterns as written; if one does not fit, the builder
stops and reports instead of forking a variant. Every batch ends with `pnpm typecheck`, `pnpm lint`, `pnpm test`, its
e2e specs plus `a11y`, `no-overflow`, `wide-screens`, `budget` specs, and 1 440 / 390 screenshots of its pages compared
with the audit's.

**Order**: batch 0 alone, merged first. Then wave A (batches 1, 2, 4) and wave B (3, 5, 6) in parallel, 2–3 builders,
each in its own worktree and E2E port. Batch 7 last, alone.

### Batch 0: shared components (lands first)
- Goal: the patterns of §2, used nowhere yet except where a one-line change in `ui.ts` already fixes every page
  (button and field sizes, `lg:w-fit`, hovers).
- Owns: `src/components/ui.ts`, `src/components/layout.ts` (`dataTable`, `num`, `empty`, `formActions`),
  `src/components/page.tsx` (+ `PeriodNav`), new `tabs.tsx`, `pager.ts` + `pager.test.ts`, `pager.tsx`, `sheet.tsx`,
  `src/sw.ts` (ignored URL parameters), `src/app/[locale]/globals.css` (dialog backdrop only if a utility can't),
  `messages/fr.json` and `messages/ar.json` (**every** new key of batches 1–7, listed per batch below, so the JSON files
  are never edited in parallel), `src/i18n` message lists if needed.
- Acceptance: no button on any wide screenshot is wider than its label + padding except phone submits; `pageWindow`
  unit-tested (1, 2, 7 and 50 pages, current at ends and middle); `Sheet` keyboard-tested (open, Tab stays inside,
  Escape closes, focus back on the opener) in one small e2e on an existing page behind no flag; offline e2e: a
  precached shell with `?tab=x` opens offline; `/fr/batches` budget ≤ 200 KB with the number reported.
- E2E likely affected: `a11y.spec.ts` (target sizes on wide), `wide-screens.spec.ts`, `no-overflow.spec.ts`,
  `budget.spec.ts`, `pwa.spec.ts`, `sw-claim.spec.ts`.
- Risks: a page that relied on a stretched button (rows in the home rail, the phone is unchanged); Arabic keys need a
  native speaker's review; the Serwist option name must be checked, not guessed.

### Batch 1: the batch page and the batches list
- Goal: §4 rows `/batches` and `/batches#<id>`.
- Owns: `batches.tsx`, `batch-dashboard.tsx`, `daily-entry.tsx`, `weighing.tsx`, `vaccinations.tsx`, `treatments.tsx`,
  `sales.tsx`, `closing.tsx`, `correct-placement.tsx`, `notifiable-diseases.tsx`, `register-links.tsx`, `eggs.tsx`,
  `layer-dashboard.tsx`, `turkey-sexes.tsx`, `placement.tsx`, `reopen-batch.tsx`, `batches/page.tsx`.
- Message keys (in batch 0): tab labels Saisie, Indicateurs, Santé, Ventes, Bande, Bilan; En cours, Clôturées.
- Acceptance: phone and wide batch page show the strip + alerts + one tab; the default tab is Saisie; each tab is
  deep-linkable (`/fr/batches?tab=sante#<id>`) and works offline; no section, form, rule or permission lost (checklist of
  the 8 sections ticked); first-load JS of `/fr/batches` not higher than before batch 1 (tabs move code into the lazy
  chunks).
- E2E: `daily-entry`, `weighing`, `vaccination`, `treatment`, `sales`, `paid-on-delivery`, `batches`, `batches-at-close`,
  `reopen`, `eggs`, `eggs-at-close`, `kpi`, `consumption`, `m1/m3/m4-journey`, `production-types`, `rodents`,
  `power-cut`, `manual-entry`, `place-from-plan`, `budget`.
- Risks: the highest. Tests that `getByRole("button", { name: "Ajouter un vaccin" })` then fill fields still work if the
  sheet keeps the same labels; tests that scroll to a section heading now need the tab click. The hash `#<id>` and
  `?tab=` must coexist (`useSyncExternalStore` on both). Budget margin.

### Batch 2: money, day to day
- Goal: §4 rows `/treasury`, `/treasury/bank`, `/receivables`, `/expenses`, `/prices`; the « Payer » pattern §2.9.
- Owns: `treasury/page.tsx`, `treasury/pay-form.tsx`, `treasury/bank/page.tsx`, `treasury/bank/forms.tsx`,
  `receivables.tsx`, `expenses.tsx`, `prices.tsx` (actions files read-only).
- Message keys: Vue d'ensemble, Rapprochement, À payer, À pointer, Toutes, Apport ou retrait (opener), filter chips.
- Acceptance: `/treasury` ≤ 1 800 px at 1 440 with demo data; no form open on load; « Payer » rows 40 px;
  bank lines filterable and paged; phone treasury has no table cut at the edge (`no-overflow`).
- E2E: `treasury`, `bank`, `receivables`, `supplier-payments`, `pay`, `expenses`, `prices`, `vat`, `advances`
  (treasury side), `screens.ts` users.
- Risks: server-action forms inside a client sheet (keep `useActionState` behaviour and error focus); the supplier pay
  form on `/stock` is batch 3's, reuse the same sheet pattern without touching `pay-form.tsx` there.

### Batch 3: stock, eggs and the small Élevage screens
- Goal: §4 rows `/stock`, `/eggs`, `/farms`, `/compare`, `/protocol`, `/planning`.
- Owns: `stock.tsx`, `egg-stock.tsx`, `egg-sale.tsx`, `farms.tsx`, `compare.tsx`, `protocol.tsx`, `planning.tsx`.
- Message keys: Articles, Achats, Fournisseurs, Modèles de référence, Copier, Planifier une bande.
- Acceptance: no visible button label repeats a record name (aria-label keeps it); purchases and collections paged,
  newest first; `/protocol` shows the farm's programme first.
- E2E: `stock`, `supplier-payments`, `eggs`, `farms`, `protocol`, `planning`, `place-from-plan`, `production-types`.
- Risks: tests that select « Modifier la bande prévue le … » by name still pass only if the aria-label keeps that exact
  text; keep it.

### Batch 4: year end
- Goal: §4 rows `/closing/count`, `/closing`, `/closing/statements`, `/books`, `/assets`, `/loans`; the « Clôture de
  l'exercice » route tabs.
- Owns: `closing/**`, `books/**`, `assets/**`, `loans/**` under `src/app/[locale]/(app)`, `entity-header.tsx`.
- Message keys: 1 Inventaire, 2 Écritures de clôture, 3 États de synthèse, Comment c'est calculé, Afficher les lignes
  vides, Plan d'amortissement, Échéancier.
- Acceptance: one primary per page; `/closing` (SARL) ≤ 1 600 px; statements print all parts on A4 (print e2e or a
  `page.pdf()` check); schedules no longer open by default.
- E2E: `closing`, `close-run`, `year-close`, `count`, `eggs-at-close`, `stocks-at-close`, `batches-at-close`, `books`,
  `manual-entry`, `period-lock`, `assets`, `loans`, `subsidies`, `vat`, `accounting-settings` (statements header).
- Risks: these specs click « Comptabiliser les écritures de clôture » and « Clôturer l'exercice » by name: keep the
  names; `?year=` must survive tab switches.

### Batch 5: analysis and accounting settings
- Goal: §4 rows `/results`, `/budget`, `/threshold`, `/settings/accounting`, `/settings/chart`, `/settings/posting`; the
  « Résultats et budget » and « Paramètres comptables » route tabs.
- Owns: `results/**`, `budget/**`, `budget.tsx`, `budget-cash.tsx`, `threshold/**`, `settings/accounting/**`,
  `settings/chart/**`, `settings/posting/**`.
- Message keys: Résultats et budget, Profil, Plan de comptes, Comptes remplacés.
- Acceptance: `/settings/accounting` has no empty half; the chart is grouped; `/settings/posting` reachable by tab.
- E2E: `accounting-settings`, `budget`, `budget-plan`, `threshold`, `report`, `expenses` (results link).
- Risks: the accountant's read-only view of `/settings/accounting` must keep hiding the forms.

### Batch 6: operations, compliance, members
- Goal: §4 rows `/climate`, `/climate/targets`, `/tasks`, `/staff`, `/inbox`, `/sync`, `/visitors`, `/disposal`,
  `/cleanout`, `/documents`, `/inspection`, `/settings/members`, `/organizations`.
- Owns: `climate.tsx`, `climate-targets.tsx`, `climate/**`, `tasks.tsx`, `staff.tsx`, `inbox.tsx`, `inbox/page.tsx`,
  `sync-status.tsx` (`SyncPanel` only; `SyncBadge` is batch 7's), `sync/page.tsx`, `biosecurity.tsx`, `documents.tsx`,
  `inspection.tsx`, `register-document.tsx`, `settings/members/**`, `organizations/**`, `join-code-form.tsx`.
- Message keys: Relevés, Cibles, Équipe, Présence, Avances, Formations et accidents, Paie, Non lues, Réglages,
  Sommaire.
- Acceptance: members' role select shows its value; `/staff` one form visible at most; `/inspection` has a table of
  contents and prints unchanged.
- E2E: `climate`, `climate-alert`, `climate-history`, `climate-targets`, `power-cut`, `tasks`, `my-tasks`,
  `assignment`, `staff`, `staff-records`, `attendance`, `advances`, `pay`, `inbox`, `sync`, `visitors`, `disposal`,
  `rodents`, `cleanout`, `documents`, `inspection`, `register`, `compliance-worker`, `members`, `switch-farm`,
  `partners`.
- Risks: biggest file count; split in two builders if needed along `biosecurity.tsx`/`documents.tsx`/`inspection.tsx`
  vs the rest (no shared file between the halves).

### Batch 7: navigation and grouping (last, alone)
- Goal: §3. Sidebar and `/more` regrouped; the header's sync chip and bell panel; merged entries active on all their
  routes; « Langue et déconnexion » off the wide sidebar.
- Owns: `more-groups.ts`, `app-nav-live.tsx`, `app-nav.tsx`, `nav-mode.ts`, `more/page.tsx`, `today.tsx` (badge
  removal), `today-wide.tsx` (« Tout voir »), the header component from the parallel task (coordinate: after it merges),
  `next.config.ts` only if a redirect is decided later.
- Acceptance: 25 links in the owner's sidebar groups, nothing half hidden at 900 px; every old URL still opens its page; the
  phone's `/more` still lists every screen the role can reach (Notifications and Sync under « Compte »).
- E2E: `sidebar`, `wide-screens`, `today`, `sync`, `inbox`, `dead-link`, `smoke`, `members`, `partners`,
  `compliance-worker` (worker's menu).
- Risks: `sidebar.spec.ts` counts and names links; the worker and accountant menus differ (`show` rules stay as they
  are, only the grouping changes).

## 6. Top 10 worst screens (to do first within each batch)
1. Batch page `/batches#<id>`: 8 sections and 2 open forms on one scroll, 12 full-width buttons (3 124 px; phone 4 979).
2. `/treasury`: 7 forms, 6 « Payer » boxes, an open « Apport ou retrait » form, a crushed 9-column table (3 763 px).
3. `/treasury/bank`: two unfiltered 30-row lists and two open forms (4 311 px).
4. `/closing` (SARL): two 992 × 56 yellow bars, paragraphs of explanation, inline value forms (2 535 px).
5. `/closing/statements`: one 5 868 px scroll for three statements.
6. `/assets` and `/loans`: every schedule printed in full (3 264 and 3 054 px).
7. `/staff`: four sections and three open forms (2 219 px).
8. `/settings/accounting` (+ `/settings/chart`, `/settings/posting`): unbalanced columns, stranded links, three pages
   for one topic, one of them in no menu.
9. `/protocol`: seven identical empty template cards push the farm's own programme aside.
10. `/documents` and `/tasks`: buttons whose visible labels repeat the record name, 400 px wide.
