import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { addFarmDays, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { houseAreas, legalEntityIn, listLegalEntities, type LegalEntityDto } from "@/modules/farm-registry";
import { batchesForFinance, type PlacementChange } from "@/modules/flock";
import { placedAssets } from "@/modules/finance/application/assets";
import { batchResultsIn } from "@/modules/finance/application/batch-results";
import { closePosted } from "@/modules/finance/application/count";
import { assetCost } from "@/modules/finance/domain/assets";
import { closeSource } from "@/modules/finance/domain/close";
import { countDay, countYearOf } from "@/modules/finance/domain/count";
import { fiscalYearOf } from "@/modules/finance/domain/entry";
import { HENS_ADULTS, classicYearEnd, productionCosts, flockYear, hensMethodOf, simplifiedProvision, simplifiedValue, simplifiedYearEnd, type HensMethod } from "@/modules/finance/domain/hens";
import type { FarmEvent, Posting } from "@/modules/finance/domain/posting";
import { depreciationToDay, PRODUCTION_EXPENSE_CATEGORIES } from "@/modules/finance/domain/production-cost";
import { standingEntryFor } from "@/modules/finance/infrastructure/ledger";

// SPEC-finance FC6 (T114, T115): laying hens and their pullets at the close, and at the transfer to lay. Reads flock
// through its index; writes only HensSchedule (the simplified current values go through saveYearEndValues).

const date = (day: string) => new Date(`${day}T00:00:00Z`);
type FiscalYear = { from: FarmDay; to: FarmDay };

/**
 * A layer or pullet batch at the close. Classic: a pullet batch still rearing, `entry` = its production cost
 * capitalised this year (23962, depreciation included, FQ19); a laying flock on 23711, `entry` = its value there,
 * `charge` = the year's depreciation, `lifeMonths` and `cullValue` typed by the owner. Simplified: `entry` = its entry
 * value (cost), `value` = birds counted × entry value per bird, `perBird` = the owner's current value of a bird,
 * `provision` below it. `missing`: a value the run needs.
 */
export type HensAtClose = {
  id: string;
  farmId: string;
  houseName: string;
  species: "layer" | "pullet";
  placedOn: string;
  onHand: number;
  entry: bigint;
  charge: bigint;
  lifeMonths: number | null;
  cullValue: bigint | null;
  perBird: bigint | null;
  value: bigint;
  provision: bigint;
  missing: boolean;
};
/** `method` null: not valued, listed "non valorisés (FQ25)" (PCA off) or nothing to post (cash book). */
export type HensClose = { method: HensMethod | null; lines: HensAtClose[]; posting: Posting | null };

/**
 * Each batch's production cost on `day` (`productionCosts`, facts dated on or before it): the VAT recovered is the
 * placement's and the batch's expenses'. `classic` (FC6 classic, 23962; FQ19, PCA p. 34): a fixed asset's production
 * cost: FN13's costs of production categories only, as FC4, plus each pullet batch's share of the production assets'
 * depreciation from its placement to the day (`depreciationToDay`). The simplified method keeps FN13's cost.
 */
async function costsOn(tx: Tx, ctx: TenantContext, entity: LegalEntityDto, day: FarmDay, classic = false) {
  const categories = classic ? { category: { in: PRODUCTION_EXPENSE_CATEGORIES } } : {};
  const [rows, batches, expenses, assets, houses] = await Promise.all([
    batchResultsIn(tx, ctx, day, classic),
    batchesForFinance(tx, ctx, day),
    tx.expense.groupBy({ by: ["batchId"], where: { organizationId: ctx.organizationId, batchId: { not: null }, day: { lte: date(day) }, ...categories }, _sum: { vatCentimes: true } }),
    classic ? placedAssets(tx, ctx, entity.id) : [],
    classic ? houseAreas(tx, ctx) : [],
  ]);
  const vat = new Map(batches.map((b) => [b.id, b.chickVatCentimes]));
  for (const e of expenses) vat.set(e.batchId!, (vat.get(e.batchId!) ?? 0n) + (e._sum.vatCentimes ?? 0n));
  // a pullet batch keeps its whole cost here, before FN13 hands it to its layer batch (costs.transferred)
  const costs = productionCosts(rows.map((r) => ({ id: r.id, costCentimes: r.costCentimes - r.costs.transferred })), vat, entity.vatRegistered);
  if (!classic) return costs;
  // ponytail: past years' shares are recomputed from today's houses and assets; a fact changing a closed year (an asset
  // entered in its opening balance, a farm house added or resized) leaves the difference on 23962 at the transfer, for
  // the accountant (SPEC-finance §9 "Pullets on 23962"). Store each close's part per batch if that case shows up.
  for (const b of batches.filter((x) => x.species === "pullet")) {
    const share = depreciationToDay(assets, houses, { id: b.id, houseId: b.houseId, placedOn: b.placedOn }, (b.closedOn ?? day) as FarmDay, entity.fiscalYearStartMonth);
    costs.set(b.id, (costs.get(b.id) ?? 0n) + share);
  }
  return costs;
}

/** FC6: the layer and pullet batches of a fiscal year, and the "hens" entry the close run posts for them. */
export async function hensAtClose(tx: Tx, ctx: TenantContext, entity: LegalEntityDto, year: FiscalYear): Promise<HensClose> {
  const method = hensMethodOf(entity.accountingProfile, entity.hensMethod);
  const batches = (await batchesForFinance(tx, ctx, year.to)).filter((b) => b.species === "layer" || b.species === "pullet");
  if (batches.length === 0) return { method, lines: [], posting: null };
  const where = { organizationId: ctx.organizationId, legalEntityId: entity.id, day: date(year.to) };
  const [costs, counted, typed, schedules] = await Promise.all([
    costsOn(tx, ctx, entity, year.to, method === "classic"),
    tx.yearEndCount.findMany({ where: { ...where, kind: "batch" }, select: { subjectId: true, quantity: true } }),
    tx.yearEndValue.findMany({ where: { ...where, kind: "hens" }, select: { subjectId: true, valueCentimes: true } }),
    tx.hensSchedule.findMany({ where: { organizationId: ctx.organizationId, legalEntityId: entity.id } }),
  ]);
  const count = new Map(counted.map((c) => [c.subjectId, c.quantity]));
  const perBirdOf = new Map(typed.map((v) => [v.subjectId, v.valueCentimes]));
  const scheduleOf = new Map(schedules.map((s) => [s.batchId, s]));
  const none = { entry: 0n, charge: 0n, lifeMonths: null, cullValue: null, perBird: null, value: 0n, provision: 0n, missing: false };
  const lineOf = (b: (typeof batches)[number]) => ({
    id: b.id,
    farmId: b.farmId,
    houseName: b.houseName,
    species: b.species as "layer" | "pullet",
    placedOn: b.placedOn,
    onHand: b.closedOn ? 0 : (count.get(b.id) ?? b.onHand),
  });
  const open = batches.filter((b) => b.closedOn === null);

  if (method === null) return { method, lines: open.map((b) => ({ ...lineOf(b), ...none })), posting: null };

  if (method === "simplified") {
    const lines = open.map((b): HensAtClose => {
      const base = lineOf(b);
      // Hens bought: their value as posted (FN9), without the VAT a registered entity recovered, with it otherwise.
      const bought = assetCost(b.chicksCentimes, b.chickVatCentimes, entity.vatRegistered);
      const entry = b.species === "pullet" ? (costs.get(b.id) ?? 0n) : b.fromBatchId ? (costs.get(b.fromBatchId) ?? 0n) : bought;
      const value = simplifiedValue(base.species, entry, b.started, base.onHand, b.sold);
      const perBird = perBirdOf.get(b.id) ?? null;
      return { ...base, ...none, entry, value, perBird, provision: perBird === null ? 0n : simplifiedProvision(value, perBird, base.onHand), missing: value > 0n && perBird === null };
    });
    const previous = await standingEntryFor(tx, ctx, "finance", closeSource("hens", entity.id, Number(year.to.slice(0, 4)) - 1));
    return { method, lines, posting: simplifiedYearEnd(lines, previous?.lines ?? []) };
  }

  // Classic: the pullets still rearing capitalise this year's production cost (to the last year end, that close did).
  const lastYearEnd = addFarmDays(year.from, -1);
  const pullets = open.filter((b) => b.species === "pullet");
  const before = pullets.some((b) => b.placedOn <= lastYearEnd) ? await costsOn(tx, ctx, entity, lastYearEnd, true) : new Map<string, bigint>();
  const lines: HensAtClose[] = pullets.map((b) => ({ ...lineOf(b), ...none, entry: (costs.get(b.id) ?? 0n) - (b.placedOn <= lastYearEnd ? (before.get(b.id) ?? 0n) : 0n) }));
  const flocks = [];
  // The laying flocks on 23711 this year: their value there is what the purchase or the transfer posted (the books).
  for (const b of batches.filter((x) => x.species === "layer" && (x.closedOn === null || x.closedOn >= year.from))) {
    const posted = [await standingEntryFor(tx, ctx, "flock", b.id), await standingEntryFor(tx, ctx, "flock", `lay:${b.id}`)];
    const entry = posted.flatMap((e) => e?.lines ?? []).reduce((s, l) => s + (l.account === HENS_ADULTS ? l.debit : 0n), 0n);
    if (entry === 0n) continue; // not on 23711: bought before T115 or free
    const schedule = scheduleOf.get(b.id);
    const fy = schedule && flockYear({ entry, entryDay: b.placedOn as FarmDay, lifeMonths: schedule.lifeMonths, cullValue: schedule.cullValueCentimes, started: b.started, out: b.out, sold: b.soldOut, closedOn: b.closedOn }, year.from, year.to);
    if (fy) flocks.push(fy);
    lines.push({ ...lineOf(b), ...none, entry, charge: fy ? fy.charge : 0n, lifeMonths: schedule?.lifeMonths ?? null, cullValue: schedule?.cullValueCentimes ?? null, missing: !schedule });
  }
  const capitalised = lines.reduce((s, l) => s + (l.species === "pullet" ? l.entry : 0n), 0n);
  return { method, lines, posting: classicYearEnd(capitalised, flocks) };
}

/** The close run's "hens" kind (FCX4, FC6). */
export const closeHens = async (tx: Tx, ctx: TenantContext, entity: LegalEntityDto, year: FiscalYear): Promise<Posting | null> => (await hensAtClose(tx, ctx, entity, year)).posting;

/**
 * FC6 classic (T115), for the posting pipeline (FN7): each batch placed or changed, as a transfer to lay. A layer batch
 * transferred from pullets (SPEC-m3 B13) carries the pullet batch's production cost (`costsOn`, classic) on the transfer
 * day and its cost at the last year end it was open on (capitalised by that close), both from the same function; any
 * other batch, or the method not classic, carries 0, so a transfer posted under the classic method is reversed. Source
 * `lay:<layer batch>`: once per batch, versioned.
 */
export async function layEvents(tx: Tx, ctx: TenantContext, entity: LegalEntityDto, changes: readonly PlacementChange[]): Promise<{ version: bigint; event: FarmEvent }[]> {
  const classic = hensMethodOf(entity.accountingProfile, entity.hensMethod) === "classic";
  const costs = new Map<string, Map<string, bigint>>();
  const costOn = async (id: string, day: FarmDay) => {
    if (!costs.has(day)) costs.set(day, await costsOn(tx, ctx, entity, day, true));
    return costs.get(day)!.get(id) ?? 0n;
  };
  const out: { version: bigint; event: FarmEvent }[] = [];
  for (const b of changes) {
    let amount = 0n;
    let capitalised = 0n;
    if (classic && b.fromBatchId) {
      amount = await costOn(b.fromBatchId, b.placedOn);
      capitalised = await costOn(b.fromBatchId, addFarmDays(fiscalYearOf(b.placedOn, entity.fiscalYearStartMonth).from, -1)); // 0: placed after it
    }
    out.push({ version: b.version, event: { type: "lay", id: `lay:${b.id}`, day: b.placedOn, amount, capitalised } });
  }
  return out;
}

const yearIn = (y: number) => Number.isInteger(y) && y >= 2000 && y <= 2100;
const MAX_LIFE = 240; // months: a sanity bound on what the owner types, not a business rule

export const SaveSchedules = z.object({ year: z.number().int(), values: z.record(z.string(), z.object({ life: z.string().trim().max(4), cull: z.string().trim().max(20) })) });

/**
 * FC6 classic (T115): the owner types each laying flock's laying period (months) and cull value (the whole flock, in
 * dirhams), never prefilled; both empty leaves a line as it is. Only a flock on 23711 in that fiscal year takes them,
 * the cull value within its entry value. Owner only, audited per flock. A schedule already typed is frozen once the
 * close run of the flock's entry year has posted (FCX4); a missing one can still be typed. Returns how many changed.
 */
export async function saveHensSchedules(ctx: TenantContext, input: unknown): Promise<Result<number, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "COUNT_FROZEN">> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = SaveSchedules.safeParse(input);
  if (!parsed.success || !yearIn(parsed.data.year)) return fail("INVALID_INPUT");
  const [first] = await listLegalEntities(ctx);
  if (!first) return fail("NOT_FOUND");
  return db.$transaction(async (tx): Promise<Result<number, "INVALID_INPUT" | "NOT_FOUND" | "COUNT_FROZEN">> => {
    const entity = await legalEntityIn(tx, ctx, first.id); // row-locked, as the close run: no run posts meanwhile
    if (!entity) return fail("NOT_FOUND");
    const start = entity.fiscalYearStartMonth;
    const close = await hensAtClose(tx, ctx, entity, fiscalYearOf(countDay(parsed.data.year, start), start));
    const flocks = new Map(close.method === "classic" ? close.lines.filter((l) => l.species === "layer").map((l) => [l.id, l]) : []);
    let changed = 0;
    for (const [id, typed] of Object.entries(parsed.data.values)) {
      const flock = flocks.get(id);
      if (!flock) return fail("INVALID_INPUT"); // not a laying flock on 23711 this year, of this organisation
      if (typed.life === "" && typed.cull === "") continue;
      const lifeMonths = /^\d{1,3}$/.test(typed.life) ? Number(typed.life) : 0;
      const cullValue = parseCentimes(typed.cull);
      if (lifeMonths < 1 || lifeMonths > MAX_LIFE || cullValue === null || cullValue > flock.entry) return fail("INVALID_INPUT");
      if (lifeMonths === flock.lifeMonths && cullValue === flock.cullValue) continue;
      if (flock.lifeMonths !== null && (await closePosted(tx, ctx, entity.id, countYearOf(flock.placedOn as FarmDay, start)))) return fail("COUNT_FROZEN");
      const key = { legalEntityId_batchId: { legalEntityId: entity.id, batchId: id } };
      const before = await tx.hensSchedule.findUnique({ where: key });
      const row = await tx.hensSchedule.upsert({
        where: key,
        create: { id: uuidv7(), organizationId: ctx.organizationId, legalEntityId: entity.id, batchId: id, lifeMonths, cullValueCentimes: cullValue, updatedBy: ctx.userId },
        update: { lifeMonths, cullValueCentimes: cullValue, updatedBy: ctx.userId },
      });
      await audit(tx, ctx, {
        entity: "HensSchedule",
        entityId: row.id,
        action: before ? "update" : "create",
        before: before ? { batchId: id, lifeMonths: before.lifeMonths, cullValueCentimes: String(before.cullValueCentimes) } : null,
        after: { batchId: id, lifeMonths, cullValueCentimes: String(cullValue) },
      }); // a web action, not a sync mutation: no mutation id
      changed++;
    }
    return ok(changed);
  });
}
