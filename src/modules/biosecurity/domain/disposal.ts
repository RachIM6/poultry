import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC-m2-compliance BS6–BS7: what leaves the farm, dead birds (law 49-99 art. 12) and manure (art. 13).

/**
 * CQ4 (decided default, to review): the official means. Arrêté n° 2127-05 du 15 décembre 2005, art. 2: an incinerator
 * or a concrete carcass pit with a watertight lid; law 49-99, art. 12: a place the administration authorizes. Anything
 * else is "other", described in words. Routine burial is not offered: lawful only in an authorized place or under an
 * outbreak order.
 */
export const DISPOSAL_METHODS = ["incineration", "sealedPit", "authorizedSite", "other"] as const;
export type DisposalMethod = (typeof DISPOSAL_METHODS)[number];

export const MANURE_DESTINATIONS = ["stored", "spread", "sold", "given"] as const;
export type ManureDestination = (typeof MANURE_DESTINATIONS)[number];

export const checkDisposal = (d: { method: DisposalMethod; methodNote: string | null }): Result<void, "DISPOSAL_METHOD_NOTE_REQUIRED"> =>
  d.method === "other" && !d.methodNote?.trim() ? fail("DISPOSAL_METHOD_NOTE_REQUIRED") : ok(undefined);

/**
 * CQ4: manure is spread only more than 500 m from any poultry farm or hatchery, unless composted (décret n° 2-04-684,
 * art. 12; arrêté n° 2127-05, art. 4). Whoever records a spreading declares it.
 */
export const checkManure = (m: { destination: ManureDestination; spreadDeclared?: boolean }): Result<void, "SPREAD_DECLARATION_REQUIRED"> =>
  m.destination === "spread" && !m.spreadDeclared ? fail("SPREAD_DECLARATION_REQUIRED") : ok(undefined);

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
