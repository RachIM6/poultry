"use client";

import { useLocale } from "next-intl";
import type { SelectHTMLAttributes } from "react";
import { formatMonth } from "@/lib/format-month";

/** "2026-11" moved by `n` months ("2026-11", 2 → "2027-01"). */
export const addMonths = (month: string, n: number) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);

/** The months from `from` to `to`, both included, oldest first. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) months.push(m);
  return months;
}

/**
 * A month as a select of month names in the page's language ("novembre 2026"), as « Début d'exercice » is: a
 * `type="month"` input shows the browser's own language ("November 2026") on a French or Arabic page.
 */
export function MonthSelect({ from, to, ...select }: { from: string; to: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const locale = useLocale();
  return (
    <select {...select}>
      {monthsBetween(from, to).map((m) => <option key={m} value={m}>{formatMonth(m, locale)}</option>)}
    </select>
  );
}
