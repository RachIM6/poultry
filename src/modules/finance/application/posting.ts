import { v7 as uuidv7 } from "uuid";
import { db, SYNC_TX, type Tx } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities, type LegalEntityDto } from "@/modules/farm-registry";
import { batchPlaces, placementsChangedSince } from "@/modules/flock";
import { issuedDebitsChangedSince, purchasesChangedSince, supplierPaymentsChangedSince } from "@/modules/inventory";
import { instrumentStepsChangedSince, paymentsChangedSince, salesChangedSince } from "@/modules/sales";
import { advancesChangedSince, payMonthsChangedSince, payPaymentsChangedSince } from "@/modules/workforce";
import { monthPeriod } from "@/modules/finance/domain/batch";
import { freezeClosedBatches } from "@/modules/finance/application/batch-results";
import { layEvents } from "@/modules/finance/application/hens";
import { alertThresholdOnce } from "@/modules/finance/application/threshold";
import { postEntry } from "@/modules/finance/application/ledger";
import { overridesFor } from "@/modules/finance/application/overrides";
import { chartOf } from "@/modules/finance/domain/chart";
import { hensMethodOf } from "@/modules/finance/domain/hens";
import { firstOpenMonth, monthOf, reversalOf } from "@/modules/finance/domain/entry";
import { inChart, postingOf, samePosting, unpostedConsumption, type FarmEvent } from "@/modules/finance/domain/posting";
import { firstPostedAt, ledgerAccounts, lockCursor, lockedMonths, moveCursor, standingEntryFor } from "@/modules/finance/infrastructure/ledger";

type Change = { version: bigint; event: FarmEvent };
type Source = { name: string; module: string; read: (tx: Tx, ctx: TenantContext, after: bigint, entity: LegalEntityDto) => Promise<Change[]> };

const SOURCES: Source[] = [
  {
    name: "inventory.purchase",
    module: "inventory",
    read: async (tx, ctx, after) =>
      (await purchasesChangedSince(tx, ctx, after)).map((p) => ({
        version: p.version,
        event: { type: "purchase", id: p.id, day: p.day, itemKind: p.itemKind, amount: p.amountCentimes, paid: p.paidCentimes, vat: p.vatCentimes, method: p.paidMethod },
      })),
  },
  {
    name: "inventory.supplierPayment",
    module: "inventory",
    read: async (tx, ctx, after) =>
      (await supplierPaymentsChangedSince(tx, ctx, after)).map((p) => ({
        version: p.version,
        event: { type: "supplierPayment", id: p.id, day: p.day as FarmDay, amount: BigInt(p.amountCentimes), method: p.method },
      })),
  },
  {
    name: "inventory.issuedDebit",
    module: "inventory",
    read: async (tx, ctx, after) =>
      (await issuedDebitsChangedSince(tx, ctx, after)).map((d) => ({ version: d.version, event: { type: "issuedDebit", id: d.id, day: d.day, amount: d.amountCentimes, kind: d.kind } })),
  },
  {
    name: "flock.placement",
    module: "flock",
    read: async (tx, ctx, after) =>
      (await placementsChangedSince(tx, ctx, after)).map((b) => ({
        version: b.version,
        event: { type: "chicks", id: b.id, day: b.placedOn, amount: b.chicksCentimes, layers: b.species === "layer" && !b.fromBatchId }, // FC6: point-of-lay hens
      })),
  },
  {
    // FC6 classic (T115): the transfer to lay (SPEC-m3 B13), once per layer batch, source `lay:<batch>`
    name: "flock.transfer",
    module: "flock",
    read: async (tx, ctx, after, entity) => layEvents(tx, ctx, entity, await placementsChangedSince(tx, ctx, after)),
  },
  {
    name: "sales.sale",
    module: "sales",
    read: async (tx, ctx, after, entity) => {
      const sales = await salesChangedSince(tx, ctx, after);
      const batches = await batchPlaces(tx, ctx, [...new Set(sales.map((s) => s.batchId))]); // FC6: culled hens of a laying flock
      return sales.map((s) => ({
        version: s.version,
        event: s.takenBy
          ? { type: "consumption", id: s.id, day: s.day, amount: s.amountCentimes, takenBy: s.takenBy, individual: entity.form === "individual" } // FC7
          : { type: "sale", id: s.id, day: s.day, amount: s.amountCentimes, paid: s.paidCentimes, method: s.method, kind: s.kind, vat: s.vatCentimes, layers: batches.get(s.batchId)?.species === "layer" },
      }));
    },
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
  {
    name: "workforce.advance",
    module: "workforce",
    read: async (tx, ctx, after) =>
      (await advancesChangedSince(tx, ctx, after)).map((a) => ({ version: a.version, event: { type: "advance", id: a.id, day: a.day as FarmDay, amount: BigInt(a.amountCentimes) } })),
  },
  {
    name: "workforce.payPayment",
    module: "workforce",
    read: async (tx, ctx, after) =>
      (await payPaymentsChangedSince(tx, ctx, after)).map((p) => ({ version: p.version, event: { type: "wagesPaid", id: p.id, day: p.day as FarmDay, amount: BigInt(p.netCentimes), from: p.paidFrom } })),
  },
  {
    name: "workforce.payMonth",
    module: "workforce",
    read: async (tx, ctx, after) =>
      (await payMonthsChangedSince(tx, ctx, after)).map((p) => ({
        version: p.version,
        event: {
          type: "pay",
          id: p.id,
          day: monthPeriod(p.month).to as FarmDay, // the month's last day
          gross: p.grossCentimes,
          advances: p.advancesCentimes,
          employeeContribution: p.employeeContributionCentimes,
          employerContribution: p.employerContributionCentimes,
          net: p.netCentimes,
        },
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
      const changes = await source.read(tx, ctx, after, entity);
      if (changes.length === 0) return 0;
      const all = await ledgerAccounts(tx);
      const chart = chartOf(all, entity.accountingProfile.base, entity.accountingProfile.overlays);
      const everything = chartOf(all, "cgnc", ["pca"]);
      const locked = await lockedMonths(tx, ctx, entity.id);
      const override = await overridesFor(tx, ctx, entity, chart);
      const classicHens = hensMethodOf(entity.accountingProfile, entity.hensMethod) === "classic"; // FC6
      const openDay = (day: FarmDay) => (locked.has(monthOf(day)) ? (`${firstOpenMonth(monthOf(day), locked)}-01` as FarmDay) : day);

      let n = 0;
      const post = async (e: Parameters<typeof postEntry>[2]) => {
        const r = await postEntry(tx, ctx, e);
        if (!r.ok) throw new Error(`${source.name} ${e.id}: ${r.error}`); // a rule or seed bug: retried at the next push
        n++;
      };
      for (const { version, event } of changes) {
        // FC7: a home consumption that can't post (FQ25, no value) is left out, and listed on /books instead
        const rule = event.type === "consumption" && unpostedConsumption(event, everything, chart) ? null : postingOf(event, entity.vatRegistered, classicHens);
        // FN8: the owner's overrides in force when the source was first posted (a new source: today's)
        const overridden = rule && override ? override(rule, await firstPostedAt(tx, ctx, source.module, event.id)) : rule;
        const posting = overridden && inChart(overridden, everything, chart);
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
    }, SYNC_TX);
  }
  await freezeClosedBatches(ctx); // FN14: a batch that closed in this push gets its allocation frozen
  if (posted > 0) await alertThresholdOnce(ctx); // FN17: the 90 % notification, once a fiscal year
  return posted;
}
