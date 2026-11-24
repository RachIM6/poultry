import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import type { EggCounts } from "@/modules/eggs/domain/collection";

// SPEC-m3 E2–E4. Pure and isomorphic. Egg stock is never stored: it is the sum of the records that add or take eggs
// (collections, gradings, discards, and later the eggs a sale drew), each kept as entered, so the phone computes it offline
// from what it already has, with the server's code.

/** Where eggs sit: not graded yet, downgraded (cracked, dirty, floor), or in a grade class (`grade:m`). */
export type EggItem = "ungraded" | "downgraded" | `grade:${string}`;
/** A lot: the eggs of one batch laid on one farm day, in one item. */
export type Lot = { batchId: string; laidOn: string; item: EggItem; eggs: number };

export type EggFlows = {
  collections: readonly { batchId: string; day: string; counts: EggCounts }[];
  gradings: readonly { batchId: string; laidOn: string; grades: Record<string, number> }[];
  discards: readonly { batchId: string; laidOn: string; item: EggItem; eggs: number }[];
  drawn?: readonly { batchId: string; laidOn: string; item: EggItem; eggs: number }[]; // sold (T63)
};

const key = (l: Pick<Lot, "batchId" | "laidOn" | "item">) => `${l.batchId}|${l.laidOn}|${l.item}`;

/** E2: eggs on hand per lot, oldest laying day first, then ungraded, downgraded, grades; empty lots left out. Broken eggs
 * never enter the stock. */
export function eggLots(f: EggFlows): Lot[] {
  const lots = new Map<string, Lot>();
  const add = (batchId: string, laidOn: string, item: EggItem, eggs: number) => {
    const l = lots.get(key({ batchId, laidOn, item })) ?? { batchId, laidOn, item, eggs: 0 };
    lots.set(key(l), { ...l, eggs: l.eggs + eggs });
  };
  for (const c of f.collections) {
    add(c.batchId, c.day, "ungraded", c.counts.normal + c.counts.doubleYolk);
    add(c.batchId, c.day, "downgraded", c.counts.cracked + c.counts.dirty + c.counts.floor);
  }
  for (const g of f.gradings) {
    for (const [grade, eggs] of Object.entries(g.grades)) {
      add(g.batchId, g.laidOn, "ungraded", -eggs);
      add(g.batchId, g.laidOn, `grade:${grade}`, eggs);
    }
  }
  for (const d of [...f.discards, ...(f.drawn ?? [])]) add(d.batchId, d.laidOn, d.item, -d.eggs);
  const rank = (i: EggItem) => (i === "ungraded" ? 0 : i === "downgraded" ? 1 : 2);
  return [...lots.values()]
    .filter((l) => l.eggs !== 0)
    .sort((a, b) => a.laidOn.localeCompare(b.laidOn) || a.batchId.localeCompare(b.batchId) || rank(a.item) - rank(b.item) || a.item.localeCompare(b.item));
}

const onHand = (lots: readonly Lot[], batchId: string, laidOn: string, item: EggItem) => lots.find((l) => key(l) === key({ batchId, laidOn, item }))?.eggs ?? 0;

/** E3: grading a laying day of a batch moves at most its ungraded eggs into grade classes. */
export function checkGrading(lots: readonly Lot[], g: { batchId: string; laidOn: string; grades: Record<string, number> }): Result<void, "INVALID_QUANTITY" | "NOT_ENOUGH_EGGS"> {
  const counts = Object.values(g.grades);
  if (counts.length === 0 || counts.some((n) => !Number.isSafeInteger(n) || n < 0) || counts.every((n) => n === 0)) return fail("INVALID_QUANTITY");
  return counts.reduce((a, n) => a + n, 0) > onHand(lots, g.batchId, g.laidOn, "ungraded") ? fail("NOT_ENOUGH_EGGS") : ok(undefined);
}

/** E3: discarding takes at most the eggs of that lot. */
export function checkDiscard(lots: readonly Lot[], d: { batchId: string; laidOn: string; item: EggItem; eggs: number }): Result<void, "INVALID_QUANTITY" | "NOT_ENOUGH_EGGS"> {
  if (!Number.isSafeInteger(d.eggs) || d.eggs <= 0) return fail("INVALID_QUANTITY");
  return d.eggs > onHand(lots, d.batchId, d.laidOn, d.item) ? fail("NOT_ENOUGH_EGGS") : ok(undefined);
}

/** E4: eggs on hand per item. */
export function stockByItem(lots: readonly Lot[]): Partial<Record<EggItem, number>> {
  const by: Partial<Record<EggItem, number>> = {};
  for (const l of lots) by[l.item] = (by[l.item] ?? 0) + l.eggs;
  return by;
}

/** E4 (P-EggStock): eggs on hand by days since laying, so the oldest are sold first. */
export const AGE_BUCKETS = ["0-2", "3-5", "6+"] as const;
export function stockByAge(lots: readonly Lot[], today: FarmDay): Record<(typeof AGE_BUCKETS)[number], number> {
  const by = { "0-2": 0, "3-5": 0, "6+": 0 };
  for (const l of lots) {
    const age = daysBetween(l.laidOn as FarmDay, today);
    by[age <= 2 ? "0-2" : age <= 5 ? "3-5" : "6+"] += l.eggs;
  }
  return by;
}

export type Draw = { laidOn: string; item: EggItem; eggs: number };
export type DrawError = "NOT_ENOUGH_EGGS" | "EGGS_IN_WITHDRAWAL" | "INVALID_QUANTITY";
/** `days`: the laying days to discard first (withheld lots FIFO reaches before the sale is filled), oldest first. */
export type DrawRefusal = { ok: false; error: Exclude<DrawError, "EGGS_IN_WITHDRAWAL"> } | { ok: false; error: "EGGS_IN_WITHDRAWAL"; days: string[] };

/**
 * SPEC-m3 V6: the eggs a sale takes from a batch, oldest laying day first (FIFO), item by item. Refused when the stock
 * is short, or when an egg it would take was laid inside a withdrawal window (H7): those must be discarded first, and the
 * refusal names their laying days. ⚠️ MQ4: the rule waits for a vet's review.
 */
export function drawFifo(
  lots: readonly Lot[],
  batchId: string,
  wanted: readonly { item: EggItem; eggs: number }[],
  withheld: readonly { from: string; to: string }[],
): { ok: true; value: Draw[] } | DrawRefusal {
  const draws: Draw[] = [];
  const days = new Set<string>();
  let short = false;
  const left = new Map(lots.filter((l) => l.batchId === batchId).map((l) => [`${l.laidOn}|${l.item}`, l.eggs]));
  for (const w of wanted) {
    if (!Number.isSafeInteger(w.eggs) || w.eggs <= 0) return fail("INVALID_QUANTITY");
    let need = w.eggs;
    for (const l of lots) {
      if (need === 0) break;
      const have = l.batchId === batchId && l.item === w.item ? (left.get(`${l.laidOn}|${l.item}`) ?? 0) : 0;
      if (have <= 0) continue;
      if (withheld.some((x) => x.from <= l.laidOn && l.laidOn <= x.to)) {
        days.add(l.laidOn); // to discard first: FIFO goes on as if it already were
        continue;
      }
      const take = Math.min(have, need);
      left.set(`${l.laidOn}|${l.item}`, have - take);
      draws.push({ laidOn: l.laidOn, item: w.item, eggs: take });
      need -= take;
    }
    if (need > 0) short = true;
  }
  if (days.size > 0) return { ok: false, error: "EGGS_IN_WITHDRAWAL", days: [...days].sort() };
  return short ? fail("NOT_ENOUGH_EGGS") : ok(draws);
}
