// SPEC-finance FN15, §9 "Budget cash need": how long after it happens a budget's chicks and feed are paid. Pure,
// Zod-free and with relative imports only: /budget recomputes it on every keystroke (prisma/seed.ts loads ../shared.ts).

/** Whole days after the chicks' placement day, and after each day's feed, that they are paid. */
export type PaymentDelays = { chicks: number; feed: number };

export const NO_DELAY: PaymentDelays = { chicks: 0, feed: 0 };

/** The farm's own delay for one input: the median of its last purchases' days, half up between the middle two; 0 with none. */
export function medianDays(days: readonly number[]): number {
  if (days.length === 0) return 0;
  const s = [...days].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : Math.floor((s[mid - 1] + s[mid] + 1) / 2);
}

/** Each day's amount paid `by` days later (a negative or fractional delay counts as its whole days, at least 0). */
export const shifted = (byDay: readonly bigint[], by: number): bigint[] => [...Array<bigint>(Math.max(0, Math.trunc(by))).fill(0n), ...byDay];
