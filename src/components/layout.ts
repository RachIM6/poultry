// Wide-screen layouts (tasks/plan-ui.md "Desktop rules"): Tailwind class strings only. Not in ui.ts, which is in
// /batches' first load: import this from pages and the screens that use it. Every string keeps the phone as it was:
// one column, the wide layout from lg.
import { card } from "@/components/ui";

/**
 * Two equal columns from lg, one below (the phone's order). Each child is a column.
 * ```tsx
 * <div className={split}><Form /><section className={splitAside}>…</section></div>
 * ```
 */
export const split = "flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8";

/** As `split`, with a 360 px aside after the main column: a summary, a history, a short list beside a form. */
export const splitNarrow = "flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-x-8";

/** On a `split` column that should stay in view while the other one scrolls. */
export const splitAside = "lg:sticky lg:top-4";

/**
 * Form fields two by two from lg. Add it to the form's own phone classes; a long field, a fieldset or the buttons take
 * the whole row with `lg:col-span-full`.
 * ```tsx
 * <form className={`flex flex-col gap-3 ${fields2}`}>…<textarea className="lg:col-span-full" />…</form>
 * ```
 */
export const fields2 = "lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6";

/**
 * A list that reads as a table from lg (WebSales.dc.html) and as cards on the phone: one `row` per item, its parts in
 * columns every row shares (CSS subgrid), under a `rowHead` hidden from screen readers (each cell says what it is).
 * The list gives its own columns. A `cell` holds a column's several parts (`contents` leaves them as they were in the card).
 * ```tsx
 * <ul className={`${rowTable} lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto]`} aria-label={…}>
 *   <li aria-hidden="true" className={rowHead}><span>Acheteur</span><span>Détail</span></li>
 *   <li className={row}><span>…</span><span className={cell}>…</span><div>…</div></li>
 * </ul>
 * ```
 */
export const rowTable =
  "flex flex-col gap-3 lg:grid lg:gap-0 lg:overflow-hidden lg:rounded-[18px] lg:bg-card lg:shadow-[0_1px_2px_rgba(36,33,28,.06),0_6px_18px_rgba(36,33,28,.05)]";
export const rowHead = "hidden px-4 py-2.5 text-sm font-medium text-ink-2 lg:col-span-full lg:grid lg:grid-cols-subgrid lg:gap-x-6 lg:bg-shell";
export const row = `${card} lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-6 lg:rounded-none lg:border-t lg:border-line lg:shadow-none`;
export const cell = "contents lg:flex lg:flex-col lg:gap-1";

// tasks/plan-ui-cleanup.md §2.3–2.8: sections, tables, form buttons and empty states, the same on every page.

/**
 * A section's header row: its h2 (`sectionTitle`), an optional count (`text-sm text-ink-2`), its actions (`secondarySm`)
 * on the end side. Then one `card` with the content.
 * ```tsx
 * <section aria-labelledby="sales"><div className={sectionHead}><h2 id="sales" className={sectionTitle}>…</h2><button className={secondarySm}>…</button></div><div className={card}>…</div></section>
 * ```
 */
export const sectionHead = "flex flex-wrap items-center justify-between gap-x-4 gap-y-2";
export const sectionTitle = "text-lg font-semibold text-ink";

/**
 * A real `<table>` for tabular data, inside `dataTableWrap` (it scrolls sideways on the phone; from lg the header row
 * sticks to the top of the page, which a scroll container would break). Amount, quantity, weight and percentage cells,
 * their `th` included, take `num`. On the phone a table of more than 4 columns is a `rowTable` instead.
 * ```tsx
 * <div className={dataTableWrap}><table className={dataTable}><thead><tr><th>Désignation</th><th className={num}>Coût</th></tr></thead>…</table></div>
 * ```
 */
export const dataTableWrap = "overflow-x-auto rounded-[18px] bg-card shadow-[0_1px_2px_rgba(36,33,28,.06),0_6px_18px_rgba(36,33,28,.05)] lg:overflow-visible";
export const dataTable =
  "w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-start [&_th]:font-medium [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_thead_th]:bg-shell [&_thead_th]:text-ink-2 [&_thead_th:first-child]:rounded-ss-[18px] [&_thead_th:last-child]:rounded-se-[18px] lg:[&_thead_th]:sticky lg:[&_thead_th]:top-0";
// text-end! (important): dataTable's `[&_th]:text-start` is the more specific rule on a header cell.
export const num = "text-end! tabular-nums whitespace-nowrap";

/** The end of a form: the submit first, « Annuler » as `ghost`. Takes the whole row of a `fields2` form. */
export const formActions = "flex flex-wrap items-center gap-3 lg:col-span-full";

/** Nothing here yet: one sentence saying what will appear and how, and at most one `secondarySm` action. */
export const empty = "flex flex-col items-center gap-3 rounded-[18px] border border-dashed border-line p-6 text-center text-sm text-ink-2";
