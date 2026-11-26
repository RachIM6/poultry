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

### 2.5 Pagination (`src/components/pager.tsx` + pure `paging.ts`, new)
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
| Pagination | in-house links (`pager.tsx`, `paging.ts`) | ~40 lines; same for server and Dexie lists |
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

### Batch 0: shared components (lands first) — done
- Goal: the patterns of §2, used nowhere yet except where a one-line change in `ui.ts` already fixes every page
  (button and field sizes, `lg:w-fit`, hovers).
- Owns: `src/components/ui.ts`, `src/components/layout.ts`, `src/components/page.tsx` (+ `PeriodNav`), new `tabs.tsx`,
  `paging.ts` + `paging.test.ts`, `pager.tsx`, `sheet.tsx`, `src/sw.ts`, the `Ui` namespace of `messages/*.json`.
- **Message keys (decision at batch 0)**: each batch adds its own keys, in its own namespaces, in fr and ar (Arabic flagged
  for a native speaker's review). The keys listed under each batch below are a guide, not something batch 0 added.
- [x] `ui.ts`: `primary`, `secondary` with their `lg:` sizes, hovers and `lg:w-fit`; new `primarySm`, `secondarySm`,
  `ghost`; `field` gains `lg:min-h-10 lg:rounded-xl lg:px-3 lg:text-base`; `link` gains `lg:w-fit` (the stretched
  « Voir le bilan », « Ajouter une charge dans Dépense rapide » links). Phone unchanged (1 440 / 390 screenshots: every
  phone screenshot byte-identical before and after; wide pages 0–264 px shorter).
- [x] `pageWindow`, `pageOf`, `pickTab` unit-tested; `e2e/ui-kit.spec.ts`: tabs (URL, back and forward, unknown tab),
  pager (range, links keep the tab, ends, `?page=99`), sheet (first field focused, Tab stays inside, Escape, « Fermer »,
  the form closing it, focus back on the opener; bottom sheet on the phone, end-side sheet from lg in fr and ar), and a
  precached shell (`/fr/batches?tab=sante&page=2`) opening offline while `?other=1` still gets the offline page.
- [x] Budget: `/fr/batches` 193.9 → 194.2 KB, `/fr/login` 147.4 → 147.5 KB (of 200).
- Deviation from the planned acceptance (« the sheet tested on an existing page behind no flag »): the components are
  proved on an e2e-only page, `src/app/[locale]/(app)/ui-kit` (404 outside the e2e build, `STRICT_MESSAGES`), so batch 0
  edits no page a later batch owns. The first batch that uses a sheet on a real page adds its own keyboard check.

**Final API (use exactly these):**
- `ui.ts`: `primary`, `secondary`, `primarySm`, `secondarySm`, `ghost`, `field`, `link` (class strings).
- `layout.ts`: `sectionHead` + `sectionTitle` (section header row and its h2); `dataTableWrap` (the card around a
  table) + `dataTable` (on `<table>`; sticky `thead th` from lg); `num` (on amount `td` and `th`, `text-end!` beats the
  table's `th` alignment); `formActions` (submit first, « Annuler » `ghost`); `empty` (dashed box, one sentence, at most
  one `secondarySm`).
- `page.tsx`: `<Page width back title subtitle actions nav>` — `actions` wrapped in a `gap-2` row on the title's end
  side, `nav` is the header's third row (`<PeriodNav>` then `<Tabs>`).
  `<PeriodNav label period prev={{ href, label }} next={{ href, label }} end? />`: `period` is a node (`<span
  dir="ltr">{year}</span>` for a year), the labels are the page's existing « mois / année précédent·e » keys, `end`
  holds « Exporter » / « Imprimer ». Server-safe.
- `paging.ts` (pure): `pickTab(keys, search.tab)` → a key (unknown or missing → the first); `pageOf(search.page, total,
  size)` → 1…last; `pageWindow(current, pageCount)` → `(number | null)[]`; `TABLE_PAGE` = 25, `CARD_PAGE` = 20.
- `tabs.tsx`: `<Tabs label current tabs={[{ key, label, href, count? }]} />`, links with `aria-current="page"` and
  `scroll={false}`; `href` is any `Link` href (`{ pathname, query: { …shared, tab: key } }` for query tabs, the sibling
  route for route tabs). Server-safe.
- `pager.tsx`: `<Pager page size total href={(n) => ({ pathname, query: { …, page: n } })} />`; renders nothing on one
  page. Server-safe; uses the `Ui` namespace (`pagination`, `previous`, `next`, `page`, `range`): a client screen lists
  `"Ui"` in its `ClientMessages`.
- `sheet.tsx` (`"use client"`): `<SheetButton label title className?>{form}</SheetButton>` (opener `secondarySm` by
  default, focus back on it on close); `<Sheet open onClose title>` for a screen that already holds its own open state
  (pair it with `useInline`, focus.ts); `useCloseSheet()` inside the form closes it once saved. The first field takes
  the focus; uses `Ui.close`, so the page lists `"Ui"`.
- `src/sw.ts`: `precacheOptions.ignoreURLParametersMatching` = Serwist's `utm_`/`fbclid` defaults + `tab` + `page`. A
  new query key a client shell reads offline must be added there.

### Batch 1: the batch page and the batches list — done
- Goal: §4 rows `/batches` and `/batches#<id>`.
- Owns: `batches.tsx`, `batch-dashboard.tsx`, `daily-entry.tsx`, `weighing.tsx`, `vaccinations.tsx`, `treatments.tsx`,
  `sales.tsx`, `closing.tsx`, `correct-placement.tsx`, `notifiable-diseases.tsx`, `register-links.tsx`, `eggs.tsx`,
  `layer-dashboard.tsx`, `turkey-sexes.tsx`, `placement.tsx`, `reopen-batch.tsx`, `batches/page.tsx`.
- Message keys: tab labels Saisie, Indicateurs, Santé, Ventes, Bande, Bilan; En cours, Clôturées.
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
- [x] Open batch: the dark strip card, the turkey sexes, the hatchery claim and the withdrawal banner stay above the
  tabs, then one tab: **Saisie du jour** (daily entry, egg collections, weighings; the default) · **Santé**
  (vaccinations, treatments, vet visits, notifiable diseases) · **Ventes** (sales, other costs and the « Dépense
  rapide » link) · **Indicateurs** (density, chart, KPI tiles) · **Gestion** (« Passage en ponte », « Corriger la mise
  en place », « Clôturer la bande »). Closed batch: **Bilan** · **Ventes**. A tab shows only when the role has
  something in it (a vet: Santé first, the weighings read with the figures; no Gestion without `flock.manage`).
- [x] Tabs are `<Tabs>` links (`?tab=<key>#<id>`), followed in place with `pushState` (no RSC round trip, offline
  too); the screen reads `?tab=` and `#<id>` from one `useSyncExternalStore` (hashchange, popstate and its own
  event). A batch opened from the list starts on its first tab; a reload or a deep link keeps the tab.
- [x] Sheets: « Ajouter un vaccin », « Ajouter un traitement », « Ajouter une visite », « Nouvelle vente / consommation
  », « Corriger la mise en place », « Passage en ponte », « Clôturer la bande », « Rouvrir la bande ». The section's
  opener sits beside its `h2` (`sectionHead`); forms end in `formActions` with « Annuler » as `ghost`. Batch-page
  sections are `h2` `sectionTitle` (were grey `h3`). Keyboard check on a real page: `e2e/treatment.spec.ts`.
- [x] List: « En cours (n) / Clôturées (n) » tabs (only once a batch is closed); closed batches one line each with
  « Voir le bilan »; « Saisir le jour » `primarySm`; « Mettre en place une bande » `secondarySm`.
- [x] Every section, form, rule and permission kept: daily entry, eggs, weighings, vaccinations (plan, done, move,
  remove, apply protocol), treatments, vet visits, notifiable diseases, sales (sale, consumption, price correction,
  cancel, origin documents), other costs, transfer, correction, close, reopen, KPIs, layer KPIs, density, claim,
  withdrawal, turkey sexes, registers and report.
- [x] Budget: `/fr/batches` 194.2 → 194.1 KB (of 200); `/fr/login` 147.6 KB.
- [x] `e2e/screens.ts` opens every tab of the realistic batches (and the closed list), so `a11y` and `no-overflow`
  check each panel.
- Deviations: « Marquer comme fait / Changer le jour / Retirer du plan » are `secondarySm` + two `ghost` buttons, not a
  « ⋯ » menu (a `<details>` menu would lose the focus return of the inline forms); the registers and the report stay as
  links in the header (`RegisterLinks`) rather than in a menu; a closed batch has no Santé tab (its health records were
  never shown on the closed screen; adding them is new scope).

### Batch 2: money, day to day — done
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
- [x] `/treasury` and `/treasury/bank`: route tabs « Vue d'ensemble · Rapprochement » (`treasury/treasury-tabs.tsx`, new,
  server-safe), one h1 « Trésorerie »; the bank page's back button and the « Rapprochement bancaire » link are gone
  (the phone keeps `back="/more"`, hidden from lg).
- [x] `/treasury`: balances (one card) beside the 4-week forecast; one « À payer » table (Échéance, Type, Fournisseur ·
  objet, Reste dû, « Payer »), the placements and the credit expenses together, oldest due first; « Payer »
  (`secondarySm`, accessible name « Payer : <name> ») opens the unchanged pay form in a sheet, amount prefilled with
  what is owed; « Apport ou retrait » is a header action opening its form in a sheet; « Mouvements du mois » is a
  `dataTable` of 7 columns, one line per movement (the date with its journal code as a badge; the batch after the
  label; label, account and counter-account truncated with the full text in `title`), `PeriodNav` over `?month=`
  (`treasuryOverview` already took a month) in the section's header row, `Pager` 25. Phone: the tables keep 2–4 columns,
  the others go under the first cell (no table cut at the edge). Saved, a sheet's form closes it and the page shows
  « Paiement enregistré. » / « Opération enregistrée. » (`TreasuryNotices`, `pay-form.tsx`).
- [x] `/treasury/bank`: the statement's four figures in one card on top; « Ajouter un relevé » and « Importer un relevé
  (fichier) » header actions → sheets (each keyed on the account and its statements, so the action's redirect closes
  it); filter tabs « À pointer (n) / Toutes » (`?tab=`, default « À pointer »: not ticked here nor on a later
  statement); the imported lines beside the book lines from lg, each paged (`?ipage=`, `?page=`); « Pointer /
  Dépointer » `secondarySm`.
- [x] `/receivables`: a cheque or bill row shows its next state as a button, the other states in a « ⋯ » `<details>`
  menu (« Autres actions : <instrument> »); « Enregistrer un paiement » and « Modifier » (credit limit) open sheets.
- [x] `/expenses`: the list is sorted and paged (`?page=`, 25) instead of cut at 20; « Ajouter une caisse ou un
  compte » is the section's action, its form in a sheet.
- [x] `/prices`: product tabs (`?tab=`, « Tous » + the products noted, with counts) and a pager over the history; the
  form stays inline.
- [x] Section headings use `sectionTitle` on these pages (one heading style).
- Heights (demo seed, full page, before → after; after includes develop's new 64 px header bar): 1 440, individual
  farm: `/treasury` 3 727 → 1 787, `/treasury/bank` 4 171 → 1 438, `/receivables` 1 599 → 1 638, `/expenses` 1 049 →
  1 054, `/prices` 2 340 → 1 681; SARL: `/treasury` 1 777 → 974, `/treasury/bank` 2 227 → 1 093. 390, individual farm:
  `/treasury` 4 697 → 4 109, `/treasury/bank` 6 812 → 3 139, `/prices` 3 783 → 2 908.
- Deviations: the « Plafonds de crédit » section of `/receivables` stays (merging it into the buyers table would drop the
  limits of buyers who owe nothing); its « Modifier » opens a sheet. The page shells `receivables/page.tsx`,
  `expenses/page.tsx`, `prices/page.tsx` (not listed above) gained `"Ui"` in their `ClientMessages`, and `/prices` a
  `Suspense` (it reads `?tab=`/`?page=`). Eight `Treasury.*` keys nothing reads any more (the old « Payer » cards',
  the movements' « Journal » and « Bande » headers) are removed. The new Arabic keys need a native speaker's review.

### Batch 3: stock, eggs and the small Élevage screens — done
- Goal: §4 rows `/stock`, `/eggs`, `/farms`, `/compare`, `/protocol`, `/planning`.
- Owns: `stock.tsx`, `egg-stock.tsx`, `egg-sale.tsx`, `farms.tsx`, `compare.tsx`, `protocol.tsx`, `planning.tsx`.
- Message keys: Articles, Achats, Fournisseurs, Modèles de référence, Copier, Planifier une bande.
- Acceptance: no visible button label repeats a record name (aria-label keeps it); purchases and collections paged,
  newest first; `/protocol` shows the farm's programme first.
- E2E: `stock`, `supplier-payments`, `eggs`, `farms`, `protocol`, `planning`, `place-from-plan`, `production-types`.
- Risks: tests that select « Modifier la bande prévue le … » by name still pass only if the aria-label keeps that exact
  text; keep it.
- [x] Header actions of a client screen: the static shell passes `actions={<span id="actions" className="contents" />}`
  to `Page`, and the screen portals its openers there (`HeaderActions`, `createPortal`), since they need its data and
  state; the title stays in the precached shell.
- [x] `/stock`: « Corriger le stock », « Ajouter un article » (`secondarySm`) and « Enregistrer un achat » (`primarySm`)
  are header actions, their forms in a sheet; for those who manage stock, query tabs **Articles** · **Achats** ·
  **Fournisseurs** (`?tab=`). Achats: newest first, `Pager` 25 (`?page=`), filtered by item (a select, kept in the
  screen's state: a new query key would need `src/sw.ts`); the silent `.slice(0, 10)` is gone. Fournisseurs (§2.9):
  one row per supplier, the soonest due first: dues, cheques and bills not yet debited (« Débité » `secondarySm`),
  « Reste dû », « Payer » (`secondarySm`, accessible name « Payer <fournisseur> ») opening the unchanged pay form in a
  sheet with what is owed filled in. A worker still sees the items only, no tabs. The items list is unchanged.
- [x] `/eggs`: « Vendre des œufs » (or « Consommation d'œufs ») a header `primarySm`; the sale, a grading and a discard
  open in a sheet (focus back on the opener); the lots are a `dataTable` (Pondus le, Bâtiment, Article, Œufs, Délai
  d'attente while one applies), newest first, `Pager` 25; on the phone the house and item go under the day. The old
  downgraded lots stay folded.
- [x] `/farms`: « Ajouter une ferme » and « Ajouter un bâtiment » (the « Bâtiments » section's action) open sheets;
  « Modifier » is `secondarySm`; no farm yet: the `empty` box with « Ajouter une ferme ». The edits stay in place.
- [x] `/protocol`: « Vos programmes » first, full width, each programme a `dataTable` (Âge, Vaccin, Mode, « Retirer »
  `ghost` named « Retirer : Jour … ») with « Ajouter un vaccin » in its header row → sheet. « Modèles de référence »:
  one compact list (name, « Copier » named « Copier pour mon exploitation : <modèle> »); what every template shares
  (not checked by a vet, no vaccine yet) is said once above it, else per row.
- [x] `/planning`: one `dataTable` per farm, a `tbody` per house (« Bandes de <bâtiment> »): Bâtiment, Bande (state,
  gap, warnings), Mise en place le, Poussins, Couvoir, Vente vers le, actions; the phone keeps the whole line under the
  house. « Prévoir une bande » (`primarySm`) and « Saisir le vide sanitaire minimum » (`secondarySm`) are header
  actions; new plan, edit, placement and rule open in a sheet, which closes once saved. Row actions « Mettre en place »,
  « Modifier », « Annuler » keep « … la bande prévue le <date> » as their accessible name.
- [x] `/compare`: no change (shared fixes only).
- [x] Budget: `/fr/batches` 194.2 KB, `/fr/login` 147.5 KB (of 200).
- Heights at 1 440, demo seed, before → after: individual `/stock` 2 069 → 948, `/eggs` 1 822 → 1 366, `/protocol`
  1 006 → 1 019, `/planning` 1 198 → 900, `/farms` and `/compare` 900 → 900; SARL `/stock` 996 → 900, others 900. At 390,
  individual: `/stock` 3 825 → 1 980, `/eggs` 3 100 → 2 254, `/protocol` 2 219 → 1 643, `/planning` 2 309 → 1 422;
  SARL `/stock` 1 627 → 938, `/protocol` 1 849 → 1 260, `/planning` 1 247 → 844.
- Deviations: the opener label « Prévoir une bande » (existing key) instead of « Planifier une bande »; stock purchases
  are filtered by a select in the section header, not chips; planning row actions are three small buttons rather than a
  « ⋯ » menu (as batch 1); the forms that moved into sheets lost the coverage `a11y.spec.ts` gave them as inline forms
  (it opens `aria-expanded` disclosures, not dialogs). New Arabic strings (`Stock.tabs`, `Stock.allItems`,
  `Stock.noPurchases`, `Stock.noSuppliers`, `Stock.colOwed`, `Stock.payOpen`, `Stock.owed`, `EggStock.colActions`,
  `Protocol.templates/notReviewed/notReviewedAll/emptyTemplates/copy/copyOf/addItemTo/removeOf/colActions/none`,
  `Planning.colBatch/colSale/colActions/stateBatch/statePlan/editShort/cancelShort`) need a native speaker's review.

### Batch 4: year end — done
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
- [x] « Clôture de l'exercice » route tabs (`closing/steps.tsx`): 1 Inventaire · 2 Écritures de clôture · 3 États de
  synthèse, each carrying `?year=`, on one row with the year's `PeriodNav` from lg. The « Inventaire de fin d'exercice »
  link on `/closing` is gone.
- [x] `/closing`: « Comptabiliser les écritures de clôture » the one primary; « Clôturer l'exercice » (or « Rouvrir ») a
  `secondary` in its own card with « À faire d'abord : comptabiliser les écritures… » while the run has something to
  post; each entry's status as a badge beside its title, the explanations under « Comment c'est calculé », entries with
  nothing to pass on one line, the entries alone two by two from lg and the stock and batch entries beside the lines they
  value. Cash-basis entity: the `empty` note instead of the brick box. Width `wide` (the page is not printed).
- [x] `/closing/statements`: query tabs Bilan actif · Bilan passif · Produits et charges · Informations complémentaires,
  all rendered, the others `hidden print:flex`, the PROJET watermark kept; all-zero postes and CPC lines
  `hidden print:table-row` behind « Afficher les lignes vides » (`?empty=1`), so paper keeps every line. `e2e/statements.spec.ts`
  (new): tabs, `?year=` across the steps, the empty lines, print media shows every part, `page.pdf()` A4, cash-basis notes.
- [x] `/closing/count`: `PeriodNav` (« Imprimer » ghost), « Selon les registres » right-aligned, compact inputs, the save
  sticky at the bottom from lg. The ruled sheet and its print stay.
- [x] `/books`: `PeriodNav` with « Exporter » ghosts, the views as `Tabs`, « Écriture manuelle » a `secondarySm` opening a
  sheet (open at once when `/treasury/bank` sends a line; it stays open after posting, its journal link closes it),
  « Période » one row, `dataTable` everywhere, cash book, journals and ledger paged by 50 lines (in-memory slice,
  `shortcut:` comment).
- [x] `/assets`: one compact card per asset (figures in a row from lg), « Plan d'amortissement » folded, « Modifier la
  durée… », « Payer la dette », « Céder… » as `secondarySm` sheets, « Ajouter une immobilisation » header `primarySm` →
  sheet; forms close their sheet once saved.
- [x] `/loans`: query tabs Emprunts · Subventions (`?tab=`), « Ajouter un emprunt / une subvention » header → sheet,
  per loan capital restant dû + « Prochaine échéance », the confirmed schedule folded (a draft's stays open to adjust and
  confirm), subsidies' « Reprise par exercice » folded.
- Heights at 1 440 (demo seed, before → after): SARL `/closing` 2 487 → 1 725 (64 px of it the header bar merged since;
  the 1 600 target is missed by the five non-empty entries of the demo SARL), `/closing/statements` 5 868 → 1 140,
  `/assets` individual 3 264 → 1 048, `/loans` individual 3 054 → 900, `/books` individual 2 020 → 1 759,
  `/closing/count` individual 1 738 → 1 678.
- Deviations: statements tabs split the bilan in actif and passif (4 tabs, the owner's wish) instead of 3; `/assets` keeps
  a card per asset (each a region with its figures, notes and actions) rather than one table with a « ⋯ » menu; the
  manual entry sheet does not close once posted (its confirmation links to the journal). Arabic strings of the new keys
  (`Close.steps`, `Close.howCalculated`, `Close.closeYearFirst`, `Statements.tabs`, `Statements.showEmpty/hideEmpty`,
  `Assets.scheduleShow`, `Loans.scheduleShow/next/tabs`, `Subsidies.releaseShow`) to check with a native speaker.

### Batch 5: analysis and accounting settings — done
- Goal: §4 rows `/results`, `/budget`, `/threshold`, `/settings/accounting`, `/settings/chart`, `/settings/posting`; the
  « Résultats et budget » and « Paramètres comptables » route tabs.
- Owns: `results/**`, `budget/**`, `budget.tsx`, `budget-cash.tsx`, `threshold/**`, `settings/accounting/**`,
  `settings/chart/**`, `settings/posting/**`.
- Message keys: Résultats et budget, Profil, Plan de comptes, Comptes remplacés.
- Acceptance: `/settings/accounting` has no empty half; the chart is grouped; `/settings/posting` reachable by tab.
- E2E: `accounting-settings`, `budget`, `budget-plan`, `threshold`, `report`, `expenses` (results link).
- Risks: the accountant's read-only view of `/settings/accounting` must keep hiding the forms.
- [x] Route tabs « Résultats et budget » (`results/results-tabs.tsx`): Résultats · Budget · Seuil d'exonération, and
  « Paramètres comptables » (`settings/accounting/settings-tabs.tsx`): Profil · Plan de comptes · Comptes remplacés, the
  last one for the owner only (`finance.manage`, the page redirects anyone else). One h1 per section, as « Trésorerie »:
  « Résultats et budget » and « Paramètres comptables ». The links card of `/settings/accounting` (owner's and
  read-only view) is gone; `/settings/posting` lost its back link to `/settings/accounting` (the phone keeps `back="/more"`).
- [x] `/results`: `dataTable` with `num` headers; the per-mille column writes U+2212, as `formatMoney`; « Aucune bande » as
  `empty`.
- [x] `/budget`: the saved budgets are a table (name, seuil, marge), each budget a row group whose second row folds its
  weekly cash (« Besoin de trésorerie par semaine »); `sectionTitle` headings; the planner unchanged otherwise.
- [x] `/threshold`: tabs; the threshold « Seuil d'exonération : 5 000 000,00 DH » is the content's first h2 (the page
  streams under the static title and tabs now).
- [x] `/settings/accounting`: one column: identity card (five fields three by three from lg, its save a `secondary`, so
  the choices' « Enregistrer » is the one primary), the lock as one `warn` line above the choices, the choices two by two
  from lg (Tenue · Plan, Début d'exercice + TVA · Poules), the shared costs' key on its own row with its three choices
  side by side. The accountant's read-only view still has no form, field or button.
- [x] `/settings/chart`: one `dataTable` grouped by class (Charges 6, Produits 7, Tiers 3 et 4, Trésorerie 5, Capitaux 1,
  an « Autres comptes » group if a class ever falls outside), class rows sticky under the sticky header from lg; the
  entity's chart column first and in bold, the other muted; the phone lists the accounts under the operation.
- [x] `/settings/posting`: a `dataTable` (Opération, Par défaut, Remplacé par, « Remplacer ») ; « Remplacer » (`secondarySm`,
  name « Remplacer : <opération> ») opens the rule's form in a sheet with « Revenir au compte par défaut » as a `ghost` when
  replaced; saved, the sheet closes and the page says « Compte enregistré… ». New e2e: sheet focus, Escape, save, back to
  the default.
- Heights (demo seed, full page, before → after): 1 440, individual farm: `/results` 900 → 951, `/budget` 1 292 → 1 351,
  `/threshold` 900 → 900, `/settings/accounting` 1 944 → 1 478, `/settings/chart` 2 244 → 1 897, `/settings/posting`
  1 399 → 1 079; SARL: `/settings/accounting` 1 882 → 1 478, `/budget` 1 088 → 1 191. 390, individual farm: `/results`
  1 599 → 1 639, `/budget` 2 382 → 2 533, `/settings/accounting` 3 152 → 3 006, `/settings/chart` 5 068 → 3 857,
  `/settings/posting` 2 264 → 1 807. The small gains on `/results` and `/budget` are the tab row.
- Deviations: `/results` keeps its 7 columns on the phone in its scrolling region (no `rowTable`); the sidebar entries are
  not merged (batch 7). `e2e/screens.ts` (not a batch file) now waits for the saved budget's row group instead of its list
  item. `Budget.title` and `Overrides.open`, read by nothing any more, are removed. New Arabic keys (`Results.section`,
  `Results.tab*`, `Accounting.tab*`, `Chart.groups`, `Overrides.replace/replaceOf`) to check with a native speaker.

### Batch 6: operations, compliance, members — done
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
- [x] Part 1 (compliance and documents, own PR): `/visitors`, `/disposal`, `/cleanout`: farm select `lg:max-w-xs`; the
  inline forms (the page's job) in a card, the visitor form two by two from lg with its checks and zones side by side;
  each log's history one card of dense rows with « Modifier » (`secondarySm`, named « Modifier : <record> ») opening the
  correction in a sheet; `/disposal`'s segmented buttons became query tabs (`?tab=dead|manure|rodents`, links, offline
  too), the 14-day table a `dataTable` with `num` columns, eliminations, manure and rodent checks paged by 25 (`?page=`)
  instead of cut at 20, with an `empty` box when there is nothing; `/visitors` lists the earlier visits as a paged table
  under today's (read only); `/cleanout`: « Commencer le nettoyage » `primarySm`, each step's « Noter / Modifier »
  (`secondarySm`) opens its form in a sheet.
- [x] `/documents`: full width; a table from lg (Document with its note, Catégorie, Ferme, Échéance with the state badge
  under it, Fichier, « Modifier »), cards on the phone; « Ajouter un document » is a header `primarySm` (the shell's
  `#actions` slot, as batch 3's `/stock`); adding and editing open a sheet; « Modifier » is short, the title stays in
  its accessible name. E2E: the edit sheet (focus, save, focus back, Escape).
- [x] `/inspection`: a « Sommaire » beside the document from lg (sticky; a row of links above it on the phone) whose links
  scroll to each part and focus it without touching the hash (it holds the farm); « Imprimer » is a `secondarySm` in the
  document's header (the button at the bottom is gone); paper prints every part as before (`print:block`, the contents
  hidden). E2E: the contents, a link's target focused with the URL unchanged, the contents hidden in print.
- Part 1 heights (demo seed, full page, before → after): 1 440, individual farm: `/visitors` 924 → 900, `/disposal`
  900 → 1 050 (the tab row and a ruled 14-day table), `/cleanout` 900 → 900, `/documents` 1 331 → 900, `/inspection`
  20 438 → 19 954; SARL: `/inspection` 9 009 → 8 837, the others 900 → 900. 390, individual farm: `/visitors`
  1 276 → 1 587 (the earlier visits, new), `/disposal` 1 704 → 1 914, `/cleanout` 1 215 → 1 223, `/documents`
  2 344 → 2 176, `/inspection` 29 730 → 29 774.
- Part 1 deviations: `/documents` keeps the file upload as a visible cell rather than in a « ⋯ » menu (its label says
  what is missing, and a `<details>` would hide the file input); the earlier visits are read only (corrections stay with
  the day's visits, as before); `Documents.colState` (the state now sits under the expiry day) is removed. New Arabic
  keys (`Visitors.earlier/colWhen`, `Disposal.noManure/noRodents`, `Documents.editShort/colFile`,
  `Inspection.contents/registerOf`) to check with a native speaker.
- [x] Part 2 (operations and members, own PR, stacked on part 1): `/climate` and `/climate/targets` route tabs **Relevés**
  · **Cibles** (`climate/climate-tabs.tsx`, server-safe), one h1 « Climat des bâtiments » as « Trésorerie »; the
  « Cibles de climat » link and the targets' back link are gone (the phone keeps `back="/more"`). `/climate`: the house
  select (`lg:max-w-xs`) and « Coupure de courant » (`secondarySm`, brick) on one row above the entry; a cut still starts
  in one tap, an open cut is one line whose « Courant revenu » opens the end form in a sheet; the readings are paged
  (`?page=`, 25) instead of cut at 10, the last 5 power cuts in view and the older ones folded (no new query key, so
  nothing to add to `src/sw.ts`). `/climate/targets`: width `wide`, each set a `dataTable` (Âge, Température, Humidité,
  Ammoniac max), « Saisir les cibles » a `primarySm` beside « Cibles en vigueur », its form in a sheet.
- [x] `/tasks`: farm select `lg:max-w-xs`; the day's rows keep the assignee select at their end from lg (compact);
  « Tâches ponctuelles prévues » and « Tâches régulières » are sections with their openers (`secondarySm`) beside the
  title, dense rows in one card; « Ajouter une tâche », « Ajouter une tâche régulière » and « Modifier » open sheets;
  the visible labels are « Modifier », « Arrêter », « Annuler », the task's title in their accessible names.
- [x] `/staff`: query tabs **Équipe** · **Présence** · **Avances** · **Formations et accidents** · **Paie** (`?tab=`); the
  accountant sees Équipe, Avances and Paie. One form at most is open: the presence entry (inline, it is that tab's
  job); « Ajouter un ouvrier », « Modifier » (named « Modifier <ouvrier> »), « Enregistrer une avance », « Enregistrer une
  formation ou un accident » and « Saisir les taux » open sheets. The records are paged (`?page=`) instead of cut at 10;
  the pay is a `dataTable` with `num` columns; each empty tab says so (`empty`).
- [x] `/inbox`: query tabs **Non lues** (with its count, the default) · **Toutes** · **Réglages** (push, the test, quiet
  hours, as cards); one dense row per notification in one card, paged by 25; a notification read on this visit stays in
  « Non lues » until the page is left. The bell panel stays batch 7's.
- [x] `/sync`: « Synchroniser maintenant » is a `secondarySm` inside the status card; the refused writes read as a table
  from lg (Écriture, Motif, Date, actions), cards on the phone; `secondarySm` « Saisir à nouveau » and « J'ai compris ».
  Width `wide`, the status card `lg:max-w-xl`. `SyncBadge` untouched (batch 7).
- [x] `/settings/members`: the role select keeps its width (`min-w-40`, the audit's P1: it collapsed to 34 px) and shows
  its value; its « Enregistrer » appears once another role is chosen; « Retirer » and « Réinitialiser le mot de passe »
  sit in a « ⋯ » `<details>` menu (named « Autres actions : <numéro> », as `/receivables`), which folds once an action
  is confirmed; « Inviter un membre » is a header `primarySm` opening the invite form in a sheet (it stays open to show
  the code once). The members' table is full width, the pending invitations one card of rows.
- [x] `/organizations`: « Ouvrir » and « Accepter » short, the farm's name in their accessible names; `sectionTitle`
  headings. `join-code-form.tsx` unchanged.
- Part 2 heights (demo seed, full page, before → after): 1 440, individual farm: `/tasks` 1 343 → 900, `/staff`
  2 169 → 900 (Équipe; every tab 900), `/inbox` 934 → 900, `/climate`, `/climate/targets`, `/sync`,
  `/settings/members`, `/organizations` 900 → 900; SARL: 900 → 900 everywhere. 390, individual farm: `/climate`
  1 714 → 1 692, `/tasks` 2 567 → 1 944, `/staff` 3 959 → 968 (Présence 1 122, Paie 885), `/inbox` 1 585 → 1 128,
  `/settings/members` 1 543 → 1 093, `/organizations` 1 125 → 1 134, `/climate/targets` and `/sync` 844 → 844; SARL:
  `/tasks` 1 203 → 892, `/settings/members` 1 125 → 844.
- Part 2 deviations: the power cut still starts in one tap (no sheet before an emergency); only its end opens a sheet.
  The older power cuts fold under a `<details>` rather than a second pager (a new query key would need `src/sw.ts`, batch
  0's). `/staff`'s, `/tasks`' and `/climate/targets`' openers sit beside their section's title, not in the page header
  (each belongs to one tab or section). Routine rows have « Modifier » (`secondarySm`) and « Arrêter » (`ghost`), not a
  « ⋯ » menu, as batches 1 and 3. Every invite in the e2e suite now opens the sheet first (11 specs, mechanical). The
  removed keys `Climate.targetsTitle/targetsOpen/bandLine` are read by nothing any more. New Arabic keys
  (`Climate.tabReadings/tabTargets/colAge/colAmmonia/olderCuts`, `Tasks.noPlanned/noRoutines/cancelShort/editShort/stopShort`,
  `Staff.tabs/editShort/none`, `Advances.none`, `Records.none`, `Inbox.tabUnread/tabAll/tabSettings/noUnread`,
  `Sync.colWhat/colWhy/colWhen`, `Members.moreOf`, `Organizations.openShort/acceptShort`) to check with a native speaker.

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
