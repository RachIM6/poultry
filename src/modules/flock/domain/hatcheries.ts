// P-Compare. Its own file: /batches ships domain/kpi.ts with the page, and this is only for /compare.

/**
 * P-Compare's hatchery table: closed batches grouped by hatchery (its name as typed, trimmed and case-insensitive; the
 * first spelling shown), most batches first. Day-7 mortality is pooled over the birds, not an average of percentages.
 */
export function hatcheryFigures(batches: readonly { hatchery: string; birdsStarted: number; day7Dead: number; dayOldWeightGrams: number | null; claim: boolean }[]) {
  const groups = new Map<string, typeof batches[number][]>();
  for (const b of batches) {
    const key = b.hatchery.trim().toLocaleLowerCase("fr");
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  return [...groups.values()]
    .map((g) => {
      const weights = g.map((b) => b.dayOldWeightGrams).filter((w): w is number => w !== null);
      return {
        hatchery: g[0].hatchery.trim(),
        batches: g.length,
        dayOldWeightGrams: weights.length ? Math.round(weights.reduce((s, w) => s + w, 0) / weights.length) : null,
        day7MortalityPercent: (g.reduce((s, b) => s + b.day7Dead, 0) / g.reduce((s, b) => s + b.birdsStarted, 0)) * 100,
        claims: g.filter((b) => b.claim).length,
      };
    })
    .sort((a, b) => b.batches - a.batches);
}
