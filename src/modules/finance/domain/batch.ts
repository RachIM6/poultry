// SPEC-finance FN13, FN14, §7. Pure; integer centimes, rounded once at the end.

/**
 * FN14: splits `total` across `keys` in proportion to their weights, by the largest remainder: each part is rounded
 * down, then the centimes left go one by one to the largest remainders (ties: the order given). The parts always sum to
 * the total. No weight at all: nothing to split on (empty map).
 */
export function allocate(total: bigint, keys: readonly { id: string; weight: bigint }[]): Map<string, bigint> {
  const sum = keys.reduce((s, k) => s + k.weight, 0n);
  const parts = new Map<string, bigint>();
  if (sum <= 0n || total === 0n) return parts;
  const rows = keys.map((k, i) => ({ id: k.id, i, part: (total * k.weight) / sum, rest: (total * k.weight) % sum }));
  let left = total - rows.reduce((s, r) => s + r.part, 0n);
  for (const r of [...rows].sort((x, y) => (y.rest > x.rest ? 1 : y.rest < x.rest ? -1 : x.i - y.i))) {
    if (left === 0n) break;
    r.part += 1n;
    left -= 1n;
  }
  for (const r of rows) parts.set(r.id, (parts.get(r.id) ?? 0n) + r.part);
  return parts;
}

/** a ÷ b rounded half away from zero, for signed amounts (a margin can be a loss). */
const divRound = (a: bigint, b: bigint) => {
  const q = a / b;
  const r = a % b;
  return 2n * (r < 0n ? -r : r) >= b ? q + (a < 0n ? -1n : 1n) : q;
};

export type BatchResult = {
  marginCentimes: bigint;
  costPerKgCentimes: bigint | null; // null when nothing was sold
  marginPerKgCentimes: bigint | null;
  marginPermille: bigint | null; // 140 = 14,0 % of sales; null without sales
};

/** FN13, §7: margin = sales − cost; per kg sold (farm weight) and as a share of sales. */
export function batchResult(r: { salesCentimes: bigint; costCentimes: bigint; soldGrams: bigint }): BatchResult {
  const margin = r.salesCentimes - r.costCentimes;
  const perKg = (c: bigint) => (r.soldGrams > 0n ? divRound(c * 1000n, r.soldGrams) : null);
  return {
    marginCentimes: margin,
    costPerKgCentimes: perKg(r.costCentimes),
    marginPerKgCentimes: perKg(margin),
    marginPermille: r.salesCentimes > 0n ? divRound(margin * 1000n, r.salesCentimes) : null,
  };
}

/** FN13's comparison with the farm's last batches, in integers: ‰ lost, FCR × 1000, DH/kg of feed and of sales. */
export type BatchComparison = { lostPermille: bigint | null; fcrMilli: bigint | null; feedPricePerKgCentimes: bigint | null; pricePerKgCentimes: bigint | null };

/** FN13: dead and culled per started bird, feed ÷ kg sold (farm weight), the feed's cost per kg and the sales' price per kg. */
export function batchComparison(r: { started: number; lost: number; feedGrams: bigint; feedCentimes: bigint; soldGrams: bigint; salesCentimes: bigint }): BatchComparison {
  return {
    lostPermille: r.started > 0 ? divRound(BigInt(r.lost) * 1000n, BigInt(r.started)) : null,
    fcrMilli: r.soldGrams > 0n && r.feedGrams > 0n ? divRound(r.feedGrams * 1000n, r.soldGrams) : null,
    feedPricePerKgCentimes: r.feedGrams > 0n ? divRound(r.feedCentimes * 1000n, r.feedGrams) : null,
    pricePerKgCentimes: r.soldGrams > 0n ? divRound(r.salesCentimes * 1000n, r.soldGrams) : null,
  };
}

/**
 * FN14: the bird-days of a batch over [from, to] (farm days, inclusive): the birds on hand at the start of each day it
 * was present. `losses` and `sold` are what left on each day (it counts from the next day).
 */
export function birdDays(b: {
  placedOn: string;
  lastDay: string | null; // the closing day, or null while open
  started: number; // chicks placed − dead on arrival
  out: readonly { day: string; birds: number }[]; // deaths, culls and sales, by day
  from: string;
  to: string;
}): bigint {
  const first = b.placedOn > b.from ? b.placedOn : b.from;
  const last = b.lastDay !== null && b.lastDay < b.to ? b.lastDay : b.to;
  if (first > last) return 0n;
  const outBefore = (day: string) => b.out.reduce((s, o) => (o.day < day ? s + o.birds : s), 0);
  let total = 0n;
  for (let d = first; d <= last; d = nextDay(d)) total += BigInt(Math.max(0, b.started - outBefore(d)));
  return total;
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** FN14: a shared line's service period from a month ("2026-10" → 1–31 Oct). */
export function monthPeriod(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
