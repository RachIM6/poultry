// layout.ts's `row` and `rowHead` for the screens whose list items are their own bordered cards on the phone (not
// ui.ts's `card`), with a tighter column gap so a table of five or six columns fits beside a 360 px form (/stock,
// /expenses). Class strings only, as layout.ts.

/** Add to the item's own card classes: a table row from lg, the card below. */
export const cardRow = "lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4 lg:rounded-none lg:border-x-0 lg:border-b-0 lg:px-4";

/** The header row that goes with `cardRow`: hidden from screen readers and on the phone. */
export const tightHead = "hidden px-4 py-2.5 text-sm font-medium text-ink-2 lg:col-span-full lg:grid lg:grid-cols-subgrid lg:gap-x-4 lg:bg-shell";
