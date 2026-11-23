import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { legalEntityIn, listLegalEntities, type LegalEntityDto } from "@/modules/farm-registry";
import { eggStockOnDay } from "@/modules/eggs";
import { batchesForFinance, lastWeighings } from "@/modules/flock";
import { stockOnDay, stockValueOnDay } from "@/modules/inventory";
import { lastSales } from "@/modules/sales";
import { batchResultsIn } from "@/modules/finance/application/batch-results";
import { closePosted } from "@/modules/finance/application/count";
import { countDay } from "@/modules/finance/domain/count";
import { batchesAtClose, eggsAtClose, stocksAtClose, yearEndBatches, yearEndProvision, yearEndStock, type BatchAtClose, type EggsAtClose, type StockAtClose } from "@/modules/finance/domain/stocks";
import type { Posting } from "@/modules/finance/domain/posting";

// SPEC-finance FC5 (T108): bought stock at the close; FC4 (T109): batches in progress; FC5 (T113): eggs. Reads
// inventory, flock, sales and eggs through their index; writes only YearEndValue.

const date = (day: string) => new Date(`${day}T00:00:00Z`);

/** Each stock item on the count day: counted (else book) quantity, its cost on that day, the owner's current value. */
export async function stockLinesAtClose(tx: Tx, ctx: TenantContext, entity: LegalEntityDto, day: FarmDay): Promise<StockAtClose[]> {
  const where = { organizationId: ctx.organizationId, legalEntityId: entity.id, day: date(day), kind: "stock" };
  const [items, values, counted, current] = await Promise.all([
    stockOnDay(tx, ctx, day),
    stockValueOnDay(tx, ctx, day, entity.vatRegistered),
    tx.yearEndCount.findMany({ where, select: { subjectId: true, quantity: true } }),
    tx.yearEndValue.findMany({ where, select: { subjectId: true, valueCentimes: true } }),
  ]);
  return stocksAtClose(items, values, new Map(counted.map((c) => [c.subjectId, c.quantity])), new Map(current.map((c) => [c.subjectId, c.valueCentimes])));
}

/**
 * FC4: each batch open at the end of the last day: birds on hand counted (FC3), else from flock; birds sold up to that
 * day; FN13's cost engaged to that day; its last weighing and the farm's last sale of that type (FQ20) up to that day;
 * and the owner's current value.
 */
export async function batchLinesAtClose(tx: Tx, ctx: TenantContext, entity: LegalEntityDto, day: FarmDay): Promise<BatchAtClose[]> {
  const where = { organizationId: ctx.organizationId, legalEntityId: entity.id, day: date(day), kind: "batch" };
  const [batches, results, weighings, sales, counted, current] = await Promise.all([
    batchesForFinance(tx, ctx, day),
    batchResultsIn(tx, ctx, day),
    lastWeighings(tx, ctx, day),
    lastSales(tx, ctx, day),
    tx.yearEndCount.findMany({ where, select: { subjectId: true, quantity: true } }),
    tx.yearEndValue.findMany({ where, select: { subjectId: true, valueCentimes: true } }),
  ]);
  const engaged = new Map(results.map((r) => [r.id, r.costCentimes]));
  const count = new Map(counted.map((c) => [c.subjectId, c.quantity]));
  const typeOf = new Map(batches.map((b) => [b.id, `${b.farmId}:${b.species}`]));
  const last = new Map<string, (typeof sales)[number]>(); // the farm's last sale of each production type
  for (const sale of sales) {
    const key = typeOf.get(sale.batchId);
    const seen = key && last.get(key);
    if (key && (!seen || sale.day > seen.day || (sale.day === seen.day && sale.id > seen.id))) last.set(key, sale);
  }
  const open = batches.filter((b) => b.closedOn === null); // as of the day: placed by then, not closed by then
  return batchesAtClose(
    open.map((b) => ({ id: b.id, farmId: b.farmId, houseName: b.houseName, species: b.species, onHand: count.get(b.id) ?? b.started - b.out.reduce((n, o) => n + o.birds, 0), sold: b.sold, engaged: engaged.get(b.id) ?? 0n })),
    weighings,
    last,
    new Map(current.map((c) => [c.subjectId, c.valueCentimes])),
  );
}

/** FC5 (T113): each farm's eggs on the count day, book (eggs' E2) and counted quantities, and the owner's value per egg. */
export async function eggLinesAtClose(tx: Tx, ctx: TenantContext, entity: LegalEntityDto, day: FarmDay): Promise<EggsAtClose[]> {
  const where = { organizationId: ctx.organizationId, legalEntityId: entity.id, day: date(day), kind: "eggs" };
  const [stock, counted, perEgg] = await Promise.all([
    eggStockOnDay(tx, ctx, day),
    tx.yearEndCount.findMany({ where, select: { subjectId: true, quantity: true } }),
    tx.yearEndValue.findMany({ where, select: { subjectId: true, valueCentimes: true } }),
  ]);
  const pca = entity.accountingProfile.overlays.includes("pca");
  return eggsAtClose(stock, new Map(counted.map((c) => [c.subjectId, c.quantity])), new Map(perEgg.map((v) => [v.subjectId, v.valueCentimes])), pca);
}

/** The close run's "batch" kind (FCX4, FC4): D 31322 / C 71311. */
export const closeBatches = async (tx: Tx, ctx: TenantContext, entity: LegalEntityDto, day: FarmDay): Promise<Posting | null> => yearEndBatches(await batchLinesAtClose(tx, ctx, entity, day));

/** The close run's "stock" kind (FCX4): D 31x / C the 6124 leaves, and D 3152 / C 71321 for the eggs. */
export const closeStock = async (tx: Tx, ctx: TenantContext, entity: LegalEntityDto, day: FarmDay): Promise<Posting | null> =>
  yearEndStock(await stockLinesAtClose(tx, ctx, entity, day), entity.accountingProfile.overlays.includes("pca"), await eggLinesAtClose(tx, ctx, entity, day));

/** The close run's "provision" kind (FCX4): D 61961 / C 3912 for the stock lines, C 3913 for the batches, below cost. */
export const closeProvision = async (tx: Tx, ctx: TenantContext, entity: LegalEntityDto, day: FarmDay): Promise<Posting | null> =>
  yearEndProvision(await stockLinesAtClose(tx, ctx, entity, day), await batchLinesAtClose(tx, ctx, entity, day));

const yearIn = (y: number) => Number.isInteger(y) && y >= 2000 && y <= 2100;

export const SaveValues = z.object({ year: z.number().int(), values: z.record(z.string(), z.string().trim().max(20)) });

/**
 * FC5, FQ20: saves the owner's current value of stock lines (the whole line, in dirhams); an empty one removes it, so
 * the line is at cost again. Only a line valued at cost takes one. FC4: the same for a meat batch open on the last
 * day (empty: back to the suggested value). FC5, FQ18 (T113): a farm's value per egg (in dirhams, to the centime), for
 * eggs that post (with the PCA). Owner only, audited per line. Once the year's close run has posted, frozen as the
 * count (FCX4), except a value given to a line the run now refuses without one (a batch or eggs of the last day
 * synced after it). Returns how many lines changed.
 */
export async function saveYearEndValues(ctx: TenantContext, input: unknown): Promise<Result<number, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "COUNT_FROZEN">> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = SaveValues.safeParse(input);
  if (!parsed.success || !yearIn(parsed.data.year)) return fail("INVALID_INPUT");
  const [first] = await listLegalEntities(ctx);
  if (!first) return fail("NOT_FOUND");
  return db.$transaction(async (tx): Promise<Result<number, "INVALID_INPUT" | "NOT_FOUND" | "COUNT_FROZEN">> => {
    const entity = await legalEntityIn(tx, ctx, first.id); // row-locked, as the close run: no run posts meanwhile
    if (!entity) return fail("NOT_FOUND");
    const frozen = await closePosted(tx, ctx, entity.id, parsed.data.year);
    const day = countDay(parsed.data.year, entity.fiscalYearStartMonth);
    const lines = new Map<string, { kind: "stock" | "batch" | "eggs"; current: bigint | null; missing?: boolean }>([
      ...(await stockLinesAtClose(tx, ctx, entity, day)).flatMap((l) => (l.cost === null ? [] : [[l.id, { kind: "stock" as const, current: l.current }] as const])),
      ...(await batchLinesAtClose(tx, ctx, entity, day)).flatMap((b) => (b.valued ? [[b.id, { kind: "batch" as const, current: b.typed, missing: b.missing }] as const] : [])),
      ...(await eggLinesAtClose(tx, ctx, entity, day)).flatMap((e) => (e.posted ? [[e.farmId, { kind: "eggs" as const, current: e.perEgg, missing: e.missing }] as const] : [])),
    ]);
    const changes: { id: string; kind: "stock" | "batch" | "eggs"; value: bigint | null }[] = [];
    for (const [id, text] of Object.entries(parsed.data.values)) {
      const line = lines.get(id);
      if (!line) return fail("INVALID_INPUT"); // not a valued stock line, meat batch or farm with eggs of this organisation
      const value = text === "" ? null : parseCentimes(text);
      if (text !== "" && value === null) return fail("INVALID_INPUT");
      if (value === line.current) continue;
      if (frozen && !(line.missing && value !== null)) return fail("COUNT_FROZEN"); // after the run: a missing value only
      changes.push({ id, kind: line.kind, value });
    }
    for (const { id, kind, value } of changes) {
      const key = { legalEntityId_day_subjectId: { legalEntityId: entity.id, day: date(day), subjectId: id } };
      const before = await tx.yearEndValue.findUnique({ where: key });
      const row =
        value === null
          ? await tx.yearEndValue.delete({ where: key }) // removed: it was there (value ≠ current)
          : await tx.yearEndValue.upsert({
              where: key,
              create: { id: uuidv7(), organizationId: ctx.organizationId, legalEntityId: entity.id, day: date(day), kind, subjectId: id, valueCentimes: value, updatedBy: ctx.userId },
              update: { valueCentimes: value, updatedBy: ctx.userId },
            });
      await audit(tx, ctx, {
        entity: "YearEndValue",
        entityId: row.id,
        action: value === null ? "delete" : before ? "update" : "create",
        before: before ? { day, subjectId: id, valueCentimes: String(before.valueCentimes) } : null,
        after: value === null ? null : { day, subjectId: id, valueCentimes: String(value) },
      }); // a web action, not a sync mutation: no mutation id
    }
    return ok(changes.length);
  });
}
