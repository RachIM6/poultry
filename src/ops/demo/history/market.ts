import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { prng } from "./story";

// The long history's market, in centimes: a live broiler price that rises in Ramadan and falls around Eid al-Adha
// (fewer birds bought while the sheep are eaten), firmer in the summer heat, and the inputs drifting slowly. Plausible
// for Morocco in 2025–2026, never a reference (no source is quoted).

const between = (day: FarmDay, from: string, to: string) => day >= from && day <= to;
const ramadan = (d: FarmDay) => between(d, "2025-02-24", "2025-03-30") || between(d, "2026-02-12", "2026-03-19");
const eid = (d: FarmDay) => between(d, "2025-05-30", "2025-06-16") || between(d, "2026-05-20", "2026-06-05");

/** A slow wander, the same for every day of a week: `amplitude` around 0. */
function wander(seed: string, amplitude: number) {
  const cache = new Map<number, number>();
  return (day: FarmDay) => {
    const week = Math.floor(daysBetween("2024-12-30" as FarmDay, day) / 7);
    if (!cache.has(week)) {
      const r = prng(`${seed}:${week}`);
      const slow = Math.sin(week / 6.5) * 0.6 + Math.sin(week / 2.3 + 1) * 0.25;
      cache.set(week, Math.round(amplitude * (slow + (r.next() - 0.5) * 0.5)));
    }
    return cache.get(week)!;
  };
}

const broilerWander = wander("broiler", 160);
const chickWander = wander("chick", 90);
const feedWander = wander("feed", 18);
const eggWander = wander("egg", 10);

export const price = {
  /** Live broiler, per kg at the farm gate. */
  broiler: (d: FarmDay) => 1_400 + broilerWander(d) + (ramadan(d) ? 260 : 0) - (eid(d) ? 320 : 0) + (Number(d.slice(5, 7)) >= 7 && Number(d.slice(5, 7)) <= 8 ? 90 : 0),
  /** A day-old broiler chick: follows the live price, a little ahead. */
  chick: (d: FarmDay) => 560 + chickWander(d) + (ramadan(d) ? 90 : 0) - (eid(d) ? 60 : 0),
  /** Compound feed, per kg, by phase. */
  feed: (d: FarmDay, phase: "starter" | "grower" | "finisher" | "layer" | "pullet" | "turkeyStart" | "turkeyGrow" | "beldi") =>
    ({ starter: 575, grower: 552, finisher: 538, layer: 492, pullet: 518, turkeyStart: 610, turkeyGrow: 575, beldi: 498 })[phase] + feedWander(d) + (d >= "2026-01-01" ? 12 : 0),
  /** An egg, ungraded, at the wholesaler's. */
  egg: (d: FarmDay) => 102 + eggWander(d) + (ramadan(d) ? 14 : 0) - (Number(d.slice(5, 7)) >= 6 && Number(d.slice(5, 7)) <= 8 ? 9 : 0),
  /** A reformed hen, by the head. */
  cullHen: (d: FarmDay) => 3_200 + Math.round(broilerWander(d) * 2.5) + (ramadan(d) ? 300 : 0),
  /** A live turkey, per kg. */
  turkey: (d: FarmDay) => 2_200 + Math.round(broilerWander(d) * 0.8) + (ramadan(d) ? 150 : 0),
};
