// Shared Tailwind classes for the Dawra / DigiAtlas-VOLAILLE look (tasks/plan-ui.md U1), so every form matches the
// mockups. Tokens live in src/app/[locale]/globals.css.

// border-muted, not border-line: a field's edge needs 3:1 (WCAG 1.4.11); muted is 5.8:1 on card, line 1.3:1.
export const field = "min-h-12 rounded-2xl border border-muted bg-card px-4 py-2 text-lg text-ink placeholder:text-muted focus:border-ink";
export const primary =
  "inline-flex min-h-14 items-center justify-center rounded-2xl bg-chick px-5 text-lg font-semibold text-ink shadow-[0_2px_0_var(--color-chick-edge)] active:translate-y-px disabled:opacity-60";
export const secondary = "inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-card px-4 font-medium text-ink disabled:opacity-60";
export const link = "inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"; // an inline text link, 44 px tall (X4)
export const card = "flex flex-col gap-2 rounded-[18px] bg-card p-4 shadow-[0_1px_2px_rgba(36,33,28,.06),0_6px_18px_rgba(36,33,28,.05)]";
export const done = "rounded-2xl bg-olive-soft p-3 text-olive"; // saved, synced
export const warn = "rounded-2xl bg-brick-soft p-3 text-brick-fg"; // missing, low
export const danger = "rounded-2xl bg-alert-soft p-3 text-alert-fg"; // withdrawal, blocked
export const table = "w-full rounded-[18px] bg-card text-sm shadow-[0_1px_2px_rgba(36,33,28,.06)] [&_th]:font-medium [&_th]:text-ink-2"; // finance tables
