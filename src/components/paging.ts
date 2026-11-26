// tasks/plan-ui-cleanup.md §2.4–2.5: the URL state of tabs and pages. Lists are paged, never cut silently. Pure, for the
// server pages and the phone's lists.

/** The tab to show: `value` (a `?tab=`) if it is one of `keys`, else the first. */
export const pickTab = <K extends string>(keys: readonly [K, ...K[]], value: unknown): K =>
  keys.includes(value as K) ? (value as K) : keys[0];

/** Rows per page: a table, a list of cards. */
export const TABLE_PAGE = 25;
export const CARD_PAGE = 20;

/** The page asked for (`?page=`), from 1 to the last page: a missing, wrong or too large value is page 1 or the last. */
export function pageOf(value: unknown, total: number, size: number): number {
  const last = Math.max(1, Math.ceil(total / size));
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 1;
  return Math.min(Math.max(n, 1), last);
}

/** The page numbers to show, `null` for a gap: 1, the last page and the current one with its neighbours, `1 … 4 5 6 … 12`. A gap never hides a single page. */
export function pageWindow(current: number, pageCount: number): (number | null)[] {
  const shown = new Set([1, pageCount, current - 1, current, current + 1]);
  const out: (number | null)[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (shown.has(p) || (shown.has(p - 1) && shown.has(p + 1))) out.push(p);
    else if (out.at(-1) !== null) out.push(null);
  }
  return out;
}
