// SPEC-finance FN15, §9 "Budget cash need". Pure and Zod-free: /budget recomputes it on every keystroke.
import { budgetOf, type BudgetInputs } from "./budget.ts";

type Weights = [day: number, weight: bigint][]; // day: days since placement (0 = placement day); weights are relative

/** When a planned batch's money moves: weights by day, scaled to the budget's amounts. */
export type CashTiming = { lastDay: number; feed: Weights; other: Weights; sales: Weights };

export type CashWeek = { week: number; outCentimes: bigint; inCentimes: bigint; cumulativeCentimes: bigint };

export type BudgetCash = {
  weeks: CashWeek[];
  peakNeedCentimes: bigint; // the most the batch is out of pocket, at any day (outflows of a day before its inflows)
  peakWeek: number | null; // the first week it is reached (the money is needed from then); null when it never is
};

/**
 * Without a base batch (§9): the feed in equal shares each day from placement to the sale (no growth curve), the
 * chicks and the other costs on placement day, the sales on the sale day.
 */
export const plainTiming = (lastDay: number): CashTiming => ({
  lastDay,
  feed: Array.from({ length: lastDay + 1 }, (_, d): [number, bigint] => [d, 1n]),
  other: [[0, 1n]],
  sales: [[lastDay, 1n]],
});

/**
 * `total` over the weights' days (clamped to the batch), each day's running total rounded half up, so the parts sum to
 * `total` exactly. No positive weight: the fallback's.
 */
function spread(total: bigint, weights: Weights, fallback: Weights, lastDay: number, into: bigint[]) {
  const byDay = new Map<number, bigint>();
  for (const [d, w] of weights) {
    const day = Math.min(Math.max(d, 0), lastDay);
    byDay.set(day, (byDay.get(day) ?? 0n) + w);
  }
  const days = [...byDay].filter(([, w]) => w > 0n).sort(([a], [b]) => a - b);
  if (days.length === 0) return spread(total, fallback, [[0, 1n]], lastDay, into);
  const sum = days.reduce((s, [, w]) => s + w, 0n);
  let run = 0n;
  let done = 0n;
  for (const [d, w] of days) {
    run += w;
    const upTo = (total * run * 2n + sum) / (2n * sum);
    into[d] += upTo - done;
    done = upTo;
  }
}

/**
 * FN15: the budget's cash, week by week from placement (week 1 = placement day and the 6 days after): the chicks
 * (placement day), the feed, the other costs and the sales spread by `timing`. Each outflow is paid on its day: the app
 * records no supplier credit terms (§9).
 */
export function budgetCash(i: BudgetInputs, timing: CashTiming): BudgetCash {
  const last = Math.max(0, timing.lastDay);
  const plain = plainTiming(last);
  const out = Array.from({ length: last + 1 }, () => 0n);
  const inflow = Array.from({ length: last + 1 }, () => 0n);
  const b = budgetOf(i);
  out[0] += i.chicks * i.chickPriceCentimes;
  spread(b.feedCostCentimes, timing.feed, plain.feed, last, out);
  spread(i.otherCostCentimes, timing.other, plain.other, last, out);
  spread(b.plannedSalesCentimes, timing.sales, plain.sales, last, inflow);

  const weeks: CashWeek[] = [];
  let cash = 0n;
  let low = 0n;
  let peakWeek: number | null = null;
  for (let d = 0; d <= last; d++) {
    const week = Math.floor(d / 7) + 1;
    if (week > weeks.length) weeks.push({ week, outCentimes: 0n, inCentimes: 0n, cumulativeCentimes: 0n });
    const w = weeks[week - 1];
    cash -= out[d];
    if (cash < low) [low, peakWeek] = [cash, week];
    cash += inflow[d];
    w.outCentimes += out[d];
    w.inCentimes += inflow[d];
    w.cumulativeCentimes = cash;
  }
  return { weeks, peakNeedCentimes: -low, peakWeek };
}
