import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { birdsOnHand } from "@/modules/flock/domain/birds";

// SPEC B4. Pure and isomorphic: the phone computes the batch's KPIs from its local data, offline. Integers in (birds,
// grams), numbers out; rounding is for display only.

/** "placed" is birds started: chicks placed minus dead on arrival (the hatchery's loss, not the farm's). */
export type BatchTotals = {
  placed: number; // birds
  dead: number; // cumulative, incl. culls
  feedGrams: number; // cumulative
  liveWeightGrams: number; // sold + estimated on hand
  ageDays: number;
  avgWeightGrams: number;
};

/** FCR = feed consumed / live weight produced. Null until something has been weighed and fed (0 would read as perfect). */
export function feedConversionRatio(t: BatchTotals): number | null {
  return t.liveWeightGrams > 0 && t.feedGrams > 0 ? t.feedGrams / t.liveWeightGrams : null;
}

/** EPEF (European Production Efficiency Factor) = livability% × avg weight kg / (age × FCR) × 100 */
export function epef(t: BatchTotals): number | null {
  const fcr = feedConversionRatio(t);
  if (fcr === null || t.ageDays === 0 || t.placed === 0) return null;
  const livability = ((t.placed - t.dead) / t.placed) * 100;
  return ((livability * (t.avgWeightGrams / 1000)) / (t.ageDays * fcr)) * 100;
}

type Day = { day: string; dead: number; culled: number; feed: { grams: number } | null };
type Weighed = { id: string; day: string; count: number; totalGrams: number };
type Sold = { day: string; birds: number; liveWeightGrams: number }; // B5: birds that left alive, at the farm's weight

export type BatchKpis = {
  ageDays: number;
  birdsOnHand: number;
  mortalityPercent: number;
  feedPerBirdGrams: number | null; // cumulative feed per bird on hand; null with no bird left
  /** From the latest weighing, with feed and mortality up to that day: today's feed over an older weight would
   * overstate the FCR. Null before the first weighing. */
  weighed: {
    day: string;
    ageDays: number;
    averageGrams: number;
    fcr: number | null;
    epef: number | null;
    dailyGainGrams: number | null; // from the day-old weight when it was entered, else from 0 g
  } | null;
};

const out = (es: readonly Day[]) => es.reduce((n, e) => n + e.dead + e.culled, 0);
const feed = (es: readonly Day[]) => es.reduce((n, e) => n + (e.feed?.grams ?? 0), 0);
const birds = (ss: readonly Sold[]) => ss.reduce((n, s) => n + s.birds, 0);

export function batchKpis(
  batch: { placedOn: FarmDay; birdsStarted: number; dayOldWeightGrams: number | null; ageAtPlacementDays?: number },
  entries: readonly Day[],
  weighings: readonly Weighed[],
  today: FarmDay,
  sold: readonly Sold[] = [],
): BatchKpis {
  const onHand = birdsOnHand(batch.birdsStarted, entries, sold);
  const last = [...weighings].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id)).at(-1); // UUIDv7: later id = later
  let weighed: BatchKpis["weighed"] = null;
  if (last) {
    const until = entries.filter((e) => e.day <= last.day); // ISO dates sort as text
    const soldUntil = sold.filter((x) => x.day <= last.day);
    const ageDays = daysBetween(batch.placedOn, last.day as FarmDay) + (batch.ageAtPlacementDays ?? 0); // SPEC-m3 B7
    const averageGrams = Math.round(last.totalGrams / last.count); // as sampleStats
    const totals: BatchTotals = {
      placed: batch.birdsStarted,
      dead: out(until),
      feedGrams: feed(until),
      liveWeightGrams: birdsOnHand(batch.birdsStarted, until, soldUntil) * averageGrams + soldUntil.reduce((g, x) => g + x.liveWeightGrams, 0),
      ageDays,
      avgWeightGrams: averageGrams,
    };
    weighed = {
      day: last.day,
      ageDays,
      averageGrams,
      fcr: feedConversionRatio(totals),
      epef: epef(totals),
      dailyGainGrams: ageDays > 0 ? (averageGrams - (batch.dayOldWeightGrams ?? 0)) / ageDays : null,
    };
  }
  return {
    ageDays: daysBetween(batch.placedOn, today) + (batch.ageAtPlacementDays ?? 0),
    birdsOnHand: onHand,
    mortalityPercent: (out(entries) / batch.birdsStarted) * 100,
    feedPerBirdGrams: onHand > 0 ? feed(entries) / onHand : null,
    weighed,
  };
}

/**
 * SPEC-m3 B14: water drunk per gram of feed (ml/g, the same as L/kg) on the latest day where both were entered: a drop
 * is an early sign of disease or a water problem. Null before such a day.
 */
export function waterPerFeed(entries: readonly { day: string; feed: { grams: number } | null; waterMl: number | null }[]): { day: string; ratio: number } | null {
  const last = entries.filter((e) => e.feed && e.waterMl !== null).sort((a, b) => a.day.localeCompare(b.day)).at(-1);
  return last ? { day: last.day, ratio: last.waterMl! / last.feed!.grams } : null;
}

/**
 * SPEC-m3 D2 (P-Compare): a closed batch's figures, from what it recorded. Every bird left alive was sold, so the FCR is
 * feed ÷ kg sold and the average weight is kg sold ÷ birds sold. Day-7 mortality counts the first week's dead and culls.
 */
export function closedBatchFigures(
  b: { placedOn: string; closedOn: string; ageAtPlacementDays?: number; birdsStarted: number },
  entries: readonly Day[],
  sold: readonly Sold[],
) {
  const soldGrams = sold.reduce((g, s) => g + s.liveWeightGrams, 0);
  const birdsSold = birds(sold);
  const ageDays = daysBetween(b.placedOn as FarmDay, b.closedOn as FarmDay) + (b.ageAtPlacementDays ?? 0);
  const firstWeek = entries.filter((e) => daysBetween(b.placedOn as FarmDay, e.day as FarmDay) <= 7);
  const totals: BatchTotals = { placed: b.birdsStarted, dead: out(entries), feedGrams: feed(entries), liveWeightGrams: soldGrams, ageDays, avgWeightGrams: birdsSold > 0 ? soldGrams / birdsSold : 0 };
  return {
    livabilityPercent: ((b.birdsStarted - out(entries)) / b.birdsStarted) * 100,
    avgWeightGrams: birdsSold > 0 ? soldGrams / birdsSold : null,
    ageDays,
    fcr: feedConversionRatio(totals),
    epef: birdsSold > 0 ? epef(totals) : null,
    day7MortalityPercent: (out(firstWeek) / b.birdsStarted) * 100,
    day7Dead: out(firstWeek),
  };
}
