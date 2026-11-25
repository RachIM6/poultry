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
