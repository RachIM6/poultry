// Shared Tailwind classes for the Dawra / DigiAtlas-VOLAILLE look (tasks/plan-ui.md U1), so every form matches the
// mockups. Tokens live in src/app/[locale]/globals.css.

// border-muted, not border-line: a field's edge needs 3:1 (WCAG 1.4.11); muted is 5.8:1 on card, line 1.3:1.
// From lg (tasks/plan-ui-cleanup.md §2.2): mouse sizes; the phone keeps its thumb sizes. lg:w-fit beats the stretch of a
// flex-col parent, so a button is as wide as its label there; a phone submit may still be full width.
export const field =
  "min-h-12 rounded-2xl border border-muted bg-card px-4 py-2 text-lg text-ink placeholder:text-muted focus:border-ink lg:min-h-10 lg:rounded-xl lg:px-3 lg:text-base";
const yellow = "bg-chick font-semibold text-ink shadow-[0_2px_0_var(--color-chick-edge)] hover:brightness-95 active:translate-y-px";
const outline = "rounded-xl border border-line bg-card font-medium text-ink hover:border-muted hover:bg-shell";
const button = "inline-flex items-center justify-center disabled:opacity-60 lg:w-fit";
/** The one main action of a form or a page. */
export const primary = `${button} ${yellow} min-h-14 rounded-2xl px-5 text-lg lg:min-h-10 lg:rounded-xl lg:px-4 lg:text-base`;
/** Other actions, openers. */
export const secondary = `${button} ${outline} min-h-11 px-4 lg:min-h-9 lg:px-3 lg:text-sm`;
/** The page header's main action, a row's main action. */
export const primarySm = `${button} ${yellow} min-h-11 rounded-xl px-4 text-base lg:min-h-8 lg:px-3 lg:text-sm`;
/** Row actions (« Payer », « Pointer », « Modifier »), a section header's action. */
export const secondarySm = `${button} ${outline} min-h-11 px-3 lg:min-h-8 lg:text-sm`;
/** Tertiary: « Annuler » in a form, « Imprimer », « Exporter ». */
export const ghost = `${button} min-h-11 rounded-lg px-2 font-medium text-ink-2 hover:bg-shell hover:text-ink lg:min-h-8`;
export const link = "inline-flex min-h-11 min-w-11 items-center underline underline-offset-4 lg:w-fit"; // an inline text link, 44 px tall (X4)
export const card = "flex flex-col gap-2 rounded-[18px] bg-card p-4 shadow-[0_1px_2px_rgba(36,33,28,.06),0_6px_18px_rgba(36,33,28,.05)]";
export const done = "rounded-2xl bg-olive-soft p-3 text-olive"; // saved, synced
export const warn = "rounded-2xl bg-brick-soft p-3 text-brick-fg"; // missing, low
export const danger = "rounded-2xl bg-alert-soft p-3 text-alert-fg"; // withdrawal, blocked
export const table = "w-full rounded-[18px] bg-card text-sm shadow-[0_1px_2px_rgba(36,33,28,.06)] [&_th]:font-medium [&_th]:text-ink-2"; // finance tables
