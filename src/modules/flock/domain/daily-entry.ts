// SPEC B2: one entry per batch per farm day. Pure and isomorphic: the phone merges and checks with the same code.

export const DEATH_CAUSES = ["unknown", "heat", "disease", "smothering", "leg", "other"] as const;
export type DeathCause = (typeof DEATH_CAUSES)[number];

export type DayFields = {
  dead: number;
  deathCause: DeathCause | null;
  culled: number;
  feed: { stockItemId: string; grams: number } | null; // becomes the day's one consumption movement (S4)
  waterMl: number | null;
  note: string | null;
};

export const EMPTY_DAY: DayFields = { dead: 0, deathCause: null, culled: 0, feed: null, waterMl: null, note: null };

/**
 * Two phones may each enter the same day offline. Each sends only the fields it changed, and the server applies them
 * in the order they arrive: the same field ends at the last write received, other fields both survive (ADR-003 §5).
 */
export const mergeDay = (previous: DayFields | null, changes: Partial<DayFields>): DayFields => ({ ...(previous ?? EMPTY_DAY), ...changes });

/** The fields of `next` that differ from `previous`: what a phone sends, so it never overwrites another's fields. */
export function changedFields(previous: DayFields | null, next: DayFields): Partial<DayFields> {
  const base = previous ?? EMPTY_DAY;
  return Object.fromEntries(
    (Object.keys(next) as (keyof DayFields)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(base[k])).map((k) => [k, next[k]]),
  ) as Partial<DayFields>;
}

/** Birds that left the batch on a day: dead and culled. */
export const birdsOut = (d: Pick<DayFields, "dead" | "culled">) => d.dead + d.culled;
