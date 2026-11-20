import { addFarmDays, daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { downgradedIn, eggsIn, type EggCounts, type EggSample } from "@/modules/eggs/domain/collection";

// SPEC-m3 E5 (P-Layers). Pure and isomorphic: the phone computes a layer batch's figures from its local records, offline.
// Integers in (birds, eggs, grams, millilitres), numbers out; rounding is for display.

type Day = { day: string; dead: number; culled: number; feed: { grams: number } | null; waterMl: number | null };
type Sold = { day: string; birds: number };
type Collection = { day: string; counts: EggCounts; sample: EggSample };

export type LayerWeek = {
  week: number; // of the birds' age
  hens: number; // on hand at the end of the week's last recorded day
  layingRate: number | null; // hen-day, %: eggs ÷ hen-days
  eggWeightGrams: number | null; // from the weighed samples
  feedPerHenGrams: number | null; // per hen per day
  waterPerFeed: number | null; // ml of water per g of feed (= L/kg)
  downgradedPercent: number | null;
};

export type LayerKpis = {
  hensHoused: number;
  hensOnHand: number;
  mortalityPercent: number;
  lastDay: { day: string; eggs: number; layingRate: number | null } | null; // the latest day with a collection
  eggsPerHenHoused: number;
  eggWeightGrams: number | null;
  feedPerEggGrams: number | null;
  downgradedPercent: number | null;
  weeks: LayerWeek[]; // oldest first, weeks with a record only
};

const sum = <T,>(xs: readonly T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0);
const ratio = (a: number, b: number, k = 1) => (b > 0 ? (a / b) * k : null);

/**
 * E5: hens on hand on a day are those housed less every bird that left before it; the hen-day rate of a day is its
 * eggs ÷ those hens. A week's rate is its eggs ÷ its hen-days, over the days that have a collection.
 */
export function layerKpis(
  batch: { placedOn: FarmDay; ageAtPlacementDays?: number; hensHoused: number },
  entries: readonly Day[],
  sold: readonly Sold[],
  collections: readonly Collection[],
  today: FarmDay,
): LayerKpis {
  const outBefore = (day: string) => sum(entries.filter((e) => e.day < day), (e) => e.dead + e.culled) + sum(sold.filter((s) => s.day < day), (s) => s.birds);
  const hensOn = (day: string) => batch.hensHoused - outBefore(day); // at the start of the day
  const eggsOn = new Map<string, number>();
  for (const c of collections) eggsOn.set(c.day, (eggsOn.get(c.day) ?? 0) + eggsIn(c.counts));
  const days = [...eggsOn.keys()].sort();
  const totalEggs = sum(collections, (c) => eggsIn(c.counts));
  const sampled = collections.filter((c) => c.sample);
  const feed = sum(entries, (e) => e.feed?.grams ?? 0);
  const last = days.at(-1);
  const hensOnHand = hensOn(addFarmDays(today, 1));

  const weekOf = (day: string) => Math.floor((daysBetween(batch.placedOn, day as FarmDay) + (batch.ageAtPlacementDays ?? 0)) / 7);
  const weeks = [...new Set([...days, ...entries.map((e) => e.day)].map(weekOf))].sort((a, b) => a - b);
  return {
    hensHoused: batch.hensHoused,
    hensOnHand,
    mortalityPercent: (sum(entries, (e) => e.dead + e.culled) / batch.hensHoused) * 100,
    lastDay: last ? { day: last, eggs: eggsOn.get(last)!, layingRate: ratio(eggsOn.get(last)!, hensOn(last), 100) } : null,
    eggsPerHenHoused: totalEggs / batch.hensHoused,
    eggWeightGrams: ratio(sum(sampled, (c) => c.sample!.grams), sum(sampled, (c) => c.sample!.count)),
    feedPerEggGrams: feed > 0 ? ratio(feed, totalEggs) : null,
    downgradedPercent: ratio(sum(collections, (c) => downgradedIn(c.counts)), totalEggs, 100),
    weeks: weeks.map((week) => {
      const cs = collections.filter((c) => weekOf(c.day) === week);
      const es = entries.filter((e) => weekOf(e.day) === week);
      const laidDays = days.filter((d) => weekOf(d) === week);
      const henDays = sum(laidDays, hensOn);
      const fedDays = es.filter((e) => e.feed);
      const watered = es.filter((e) => e.feed && e.waterMl !== null);
      const eggs = sum(cs, (c) => eggsIn(c.counts));
      const weighed = cs.filter((c) => c.sample);
      const lastDay = [...laidDays, ...es.map((e) => e.day)].sort().at(-1)!;
      return {
        week,
        hens: hensOn(addFarmDays(lastDay as FarmDay, 1)),
        layingRate: ratio(eggs, henDays, 100),
        eggWeightGrams: ratio(sum(weighed, (c) => c.sample!.grams), sum(weighed, (c) => c.sample!.count)),
        feedPerHenGrams: ratio(sum(fedDays, (e) => e.feed!.grams), sum(fedDays, (e) => hensOn(e.day))),
        waterPerFeed: ratio(sum(watered, (e) => e.waterMl!), sum(watered, (e) => e.feed!.grams)),
        downgradedPercent: ratio(sum(cs, (c) => downgradedIn(c.counts)), eggs, 100),
      };
    }),
  };
}
