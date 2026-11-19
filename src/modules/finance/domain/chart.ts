import type { AccountRow, Chart } from "@/modules/finance/schema";

/**
 * ADR-010 §2: an entity's chart is one base + overlays. An overlay account can redefine a base number, so it wins.
 * Roll-ups follow the explicit parent, never the number's prefix.
 */
export type ChartOfAccounts = ReadonlyMap<string, AccountRow>;

export function chartOf(all: readonly AccountRow[], base: Chart, overlays: readonly Chart[]): ChartOfAccounts {
  const order = [base, ...overlays];
  const chart = new Map<string, AccountRow>();
  for (const c of order) for (const a of all) if (a.chart === c) chart.set(a.number, a);
  return chart;
}

/** The account and its ancestors up to the class: 612122 → 61212 → 6121 → 612 → 61 → 6. */
export function rollUp(number: string, chart: ChartOfAccounts): string[] {
  const path: string[] = [];
  for (let n: string | null = number; n !== null; n = chart.get(n)?.parent ?? null) {
    if (!chart.has(n) || path.includes(n)) throw new Error(`account ${n} is not in this chart`); // programming error
    path.push(n);
  }
  return path;
}

/**
 * Where a rule's account lands in this entity's chart (SPEC-finance FN2, FN6): the account itself, or with an
 * overlay switched off its declared fallback (612122 Aliments de bétail → 6121), else its nearest ancestor the chart
 * has. Null if none.
 */
export function postingAccount(number: string, everything: ChartOfAccounts, chart: ChartOfAccounts): string | null {
  for (let n: string | null = number, hops = 0; n !== null && hops < 10; hops++) {
    if (chart.has(n)) return n;
    const a = everything.get(n);
    n = a?.fallback ?? a?.parent ?? null;
  }
  return null;
}
