import { v7 as uuidv7 } from "uuid";
import { registry } from "@/app/api/sync/registry";
import { db, SYNC_TX } from "@/lib/db";
import { fixedClock, type Clock } from "@/lib/kernel/clock";
import { addFarmDays, daysBetween, farmInstant, type FarmDay } from "@/lib/kernel/farm-day";
import { decide } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { postPending } from "@/modules/finance";

// The long history's engine (src/ops/demo/history): a seeded random story, written as the farm's members would have
// typed it, day after day, through the app's own sync rules and use cases.

/** A seeded generator (mulberry32 over a string hash): the same seed tells the same story on every run. */
export function prng(seed: string) {
  let a = 2166136261;
  for (const c of seed) a = Math.imul(a ^ c.charCodeAt(0), 16777619);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
    /** `x`, give or take `spread` (0.05: ±5 %). */
    around: (x: number, spread: number) => x * (1 + (next() * 2 - 1) * spread),
  };
}
export type Rng = ReturnType<typeof prng>;

export type Actor = "owner" | "manager" | "worker" | "vet";
/** Money a step moves, in centimes: what the treasurer (farm.ts, company.ts) keeps the cash box and the bank above. */
export type Flow = { cash?: number; bank?: number };
type Base = { day: FarmDay; rank: number };
export type MutationStep = Base & { as: Actor; type: string; payload: object; flow?: Flow };
/** A use case typed online (assets, loans, statements, the year close), after the books have posted what came before. */
export type CallStep = Base & { label: string; call: (clock: Clock) => Promise<{ ok: boolean }>; flow?: Flow };
export type Step = MutationStep | CallStep;

/** Within a day: deliveries first, then the flock's day, its sales, the clean-out, money, the team, the evening. */
export const RANK = { setup: 0, buy: 10, place: 20, care: 30, day: 40, eggs: 45, sale: 50, close: 60, money: 70, staff: 80, call: 85, late: 90 } as const;

export class Story {
  readonly steps: Step[] = [];
  /** Money that moves without a write of its own that day (an accepted bill leaving the bank on its due day). */
  readonly flows: { day: FarmDay; flow: Flow }[] = [];
  constructor(readonly from: FarmDay, readonly today: FarmDay) {}
  /** A sync mutation typed by `as` on `day`. Nothing after today and nothing before the story begins. */
  add(day: FarmDay, rank: number, as: Actor, type: string, payload: object, flow?: Flow) {
    if (day > this.today || day < this.from) return false;
    this.steps.push({ day, rank, as, type, payload, flow });
    return true;
  }
  call(day: FarmDay, label: string, call: CallStep["call"], flow?: Flow, rank: number = RANK.call) {
    if (day > this.today || day < this.from) return false;
    this.steps.push({ day, rank, label, call, flow });
    return true;
  }
  flow(day: FarmDay, flow: Flow) {
    if (day <= this.today && day >= this.from) this.flows.push({ day, flow });
  }
  /** The steps in the order they happened (stable within a day and rank). */
  sorted() {
    return this.steps.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : x.rank - y.rank));
  }
  days() {
    return Array.from({ length: daysBetween(this.from, this.today) + 1 }, (_, i) => addFarmDays(this.from, i));
  }
}

const CHUNK = 150; // mutations to a transaction: the same handlers as a push, a fraction of the round trips
// Finance posts a source's backlog in one transaction of SYNC_TX (15 s, sized for a phone's push): a chunk's backlog
// over a network to the hosted database outlasts it, so this process (the seed only) gives those transactions 5 minutes.
SYNC_TX.timeout = Math.max(SYNC_TX.timeout, 5 * 60_000);
const TX = { timeout: 15 * 60_000, maxWait: 30_000 };

export type Write = { ctx: TenantContext; type: string; payload: object; day?: FarmDay };

/**
 * Applies `writes`, CHUNK to a transaction, each as its member through the same `decide` as a phone's push (permission,
 * schema, the module's rules, audit, sync log), each recorded in Mutation; a refusal stops everything.
 */
export async function applyAll(writes: Write[], label = "demo") {
  for (let i = 0; i < writes.length; i += CHUNK)
    await db.$transaction(async (tx) => {
      for (const w of writes.slice(i, i + CHUNK)) {
        const m = { id: uuidv7(), type: w.type, payload: w.payload, createdAt: (w.day ? farmInstant(w.day, 18 * 60) : new Date()).toISOString() };
        const result = await decide(tx, w.ctx, m, registry);
        if (result.status !== "applied") throw new Error(`demo (${label}): ${m.type}${w.day ? ` on ${w.day}` : ""} refused ${JSON.stringify(result)} ${JSON.stringify(m.payload)}`);
        await tx.mutation.create({ data: { id: m.id, organizationId: w.ctx.organizationId, userId: w.ctx.userId, type: m.type, result } });
      }
    }, TX);
  return writes.length;
}

/**
 * Plays the story in order: CHUNK mutations at a time, whoever typed them, the books posted after each (FN7, as the
 * push route posts after a push); a call runs on its day's clock (17:00 on the farm), after the books.
 */
export async function play(actors: Record<Actor, TenantContext>, story: Story, label: string) {
  const steps = story.sorted();
  let applied = 0;
  let calls = 0;
  for (let i = 0; i < steps.length; ) {
    const s = steps[i];
    if ("call" in s) {
      const r = await s.call(fixedClock(farmInstant(s.day, 17 * 60).toISOString()));
      if (!r.ok) throw new Error(`demo (${label}): ${s.label} on ${s.day} refused ${JSON.stringify(r)}`);
      calls++;
      i++;
      continue;
    }
    const chunk: Write[] = [];
    for (; i < steps.length && chunk.length < CHUNK && !("call" in steps[i]); i++) {
      const m = steps[i] as MutationStep;
      chunk.push({ ctx: actors[m.as], type: m.type, payload: m.payload, day: m.day });
    }
    applied += await applyAll(chunk, label);
    await postPending(actors.owner);
  }
  return { applied, calls };
}
