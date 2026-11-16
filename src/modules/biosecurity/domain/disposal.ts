import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC-m2-compliance BS6–BS7: what leaves the farm, dead birds (law 49-99 art. 12) and manure (art. 13).

/**
 * The methods NEEDS-ANALYSIS §4 and SCOPE §13 name. The authorized list and distances wait for ONSSA (CQ4): anything
 * else is "other", described in words, never a method we made up.
 */
export const DISPOSAL_METHODS = ["incineration", "authorizedSite", "other"] as const;
export type DisposalMethod = (typeof DISPOSAL_METHODS)[number];

export const MANURE_DESTINATIONS = ["stored", "spread", "sold", "given"] as const;
export type ManureDestination = (typeof MANURE_DESTINATIONS)[number];

export const checkDisposal = (d: { method: DisposalMethod; methodNote: string | null }): Result<void, "DISPOSAL_METHOD_NOTE_REQUIRED"> =>
  d.method === "other" && !d.methodNote?.trim() ? fail("DISPOSAL_METHOD_NOTE_REQUIRED") : ok(undefined);

type DayBirds = { day: string; birds: number };
export type DisposalGap = { day: string; dead: number; disposed: number; gap: number };

/** Per farm day: birds that died or were culled (daily entries) against birds disposed. A gap shows what's unaccounted. */
export function disposalGaps(mortality: readonly DayBirds[], disposals: readonly DayBirds[]): DisposalGap[] {
  const days = new Map<string, DisposalGap>();
  const at = (day: string) => days.get(day) ?? days.set(day, { day, dead: 0, disposed: 0, gap: 0 }).get(day)!;
  for (const m of mortality) at(m.day).dead += m.birds;
  for (const d of disposals) at(d.day).disposed += d.birds;
  return [...days.values()].map((g) => ({ ...g, gap: g.dead - g.disposed })).sort((x, y) => y.day.localeCompare(x.day));
}
