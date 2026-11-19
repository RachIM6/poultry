import { v7 as uuidv7 } from "uuid";
import { db, type Tx } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { placementsChangedSince } from "@/modules/flock";
import { purchasesChangedSince } from "@/modules/inventory";
import { instrumentStepsChangedSince, paymentsChangedSince, salesChangedSince } from "@/modules/sales";
import { postEntry } from "@/modules/finance/application/ledger";
import { chartOf } from "@/modules/finance/domain/chart";
import { firstOpenMonth, monthOf, reversalOf } from "@/modules/finance/domain/entry";
import { inChart, postingOf, samePosting, type FarmEvent } from "@/modules/finance/domain/posting";
import { ledgerAccounts, lockCursor, lockedMonths, moveCursor, standingEntryFor } from "@/modules/finance/infrastructure/ledger";

type Change = { version: bigint; event: FarmEvent };
type Source = { name: string; module: string; read: (tx: Tx, ctx: TenantContext, after: bigint) => Promise<Change[]> };

const SOURCES: Source[] = [
  {
    name: "inventory.purchase",
    module: "inventory",
    read: async (tx, ctx, after) =>
      (await purchasesChangedSince(tx, ctx, after)).map((p) => ({
        version: p.version,
        event: { type: "purchase", id: p.id, day: p.day, itemKind: p.itemKind, amount: p.amountCentimes, paid: p.paidCentimes },
      })),
  },
  {
    name: "flock.placement",
    module: "flock",
    read: async (tx, ctx, after) =>
      (await placementsChangedSince(tx, ctx, after)).map((b) => ({
        version: b.version,
        event: { type: "chicks", id: b.id, day: b.placedOn, amount: b.chicksCentimes },
      })),
  },
  {
    name: "sales.sale",
    module: "sales",
    read: async (tx, ctx, after) =>
      (await salesChangedSince(tx, ctx, after)).map((s) => ({
        version: s.version,
        event: { type: "sale", id: s.id, day: s.day, amount: s.amountCentimes, paid: s.paidCentimes, method: s.method },
      })),
  },
  {
    name: "sales.payment",
    module: "sales",
    read: async (tx, ctx, after) =>
      (await paymentsChangedSince(tx, ctx, after)).map((p) => ({
        version: p.version,
        event: { type: "receipt", id: p.id, day: p.day, amount: p.amountCentimes, method: p.method },
      })),
  },
  {
    name: "sales.instrument",
    module: "sales",
    read: async (tx, ctx, after) =>
      (await instrumentStepsChangedSince(tx, ctx, after)).map((i) => ({
        version: i.version,
        event: { type: "instrument", id: i.id, day: i.day, amount: i.amountCentimes, kind: i.kind, from: i.from, to: i.to },
      })),
  },
];

/**
 * SPEC-finance FN7: posts the farm events recorded since each source's cursor, on the server only. Idempotent: a
 * replay finds the cursor moved and the source key taken. A newer version of a record that changes its entry gets a
 * reversal and a new entry; one that doesn't (a batch closing) posts nothing. A locked month sends the entry to the
 * first open month (FN5). Runs after each sync push (api/sync/push) and on demand. Returns the entries posted.
 */
export async function postPending(pusher: TenantContext): Promise<number> {
  // ponytail: one legal entity per organisation in M1 (onboarding); farms get their entity when there are several.
  const [entity] = await listLegalEntities(pusher);
  if (!entity) return 0;
  // Posting is the server's own work, whoever pushed: what it reads was already authorised when it was recorded
  // (purchases need stock.manage, placements flock.manage), and a worker's push must not hold postings back.
  const ctx: TenantContext = { ...pusher, role: "owner" };
  let posted = 0;
  for (const source of SOURCES) {
    posted += await db.$transaction(async (tx) => {
      const after = await lockCursor(tx, ctx, source.name);
      const changes = await source.read(tx, ctx, after);
      if (changes.length === 0) return 0;
      const all = await ledgerAccounts(tx);
      const chart = chartOf(all, entity.accountingProfile.base, entity.accountingProfile.overlays);
      const everything = chartOf(all, "cgnc", ["pca"]);
      const locked = await lockedMonths(tx, ctx, entity.id);
      const openDay = (day: FarmDay) => (locked.has(monthOf(day)) ? (`${firstOpenMonth(monthOf(day), locked)}-01` as FarmDay) : day);

      let n = 0;
      const post = async (e: Parameters<typeof postEntry>[2]) => {
        const r = await postEntry(tx, ctx, e);
        if (!r.ok) throw new Error(`${source.name} ${e.id}: ${r.error}`); // a rule or seed bug: retried at the next push
        n++;
      };
      for (const { version, event } of changes) {
        const rule = postingOf(event);
        const posting = rule && inChart(rule, everything, chart);
        if (rule && !posting) throw new Error(`${source.name} ${event.id}: an account has no home in this chart`);
        const day = openDay(event.day);
        const standing = await standingEntryFor(tx, ctx, source.module, event.id);
        if (standing && posting && samePosting(standing, { day, lines: posting.lines })) continue;
        if (standing) {
          await post({ id: uuidv7(), legalEntityId: entity.id, journal: standing.journal, day, label: "Annulation", reversesId: standing.id, lines: reversalOf(standing.lines) });
        }
        if (posting) {
          const key = { module: source.module, id: event.id, version: Number(version) };
          await post({ id: uuidv7(), legalEntityId: entity.id, journal: posting.journal, day, label: posting.label, reversesId: null, lines: posting.lines, source: key });
        }
      }
      await moveCursor(tx, ctx, source.name, changes.at(-1)!.version);
      return n;
    });
  }
  return posted;
}
