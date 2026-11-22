import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { legalEntityIn, listLegalEntities, placeNames } from "@/modules/farm-registry";
import { batchesForFinance } from "@/modules/flock";
import { stockOnDay } from "@/modules/inventory";
import { CLOSE_KINDS, closeSource } from "@/modules/finance/domain/close";
import { countDay, countLines, countYearOf, parseCounted, type CountLine } from "@/modules/finance/domain/count";

// SPEC-finance FC3: the year-end count. Reads flock and inventory through their index; writes only YearEndCount.

export type CountSheet = { year: number; day: FarmDay; frozen: boolean; farms: { id: string; name: string; lines: CountLine[] }[] };

const date = (day: string) => new Date(`${day}T00:00:00Z`);

async function sheet(tx: Tx, ctx: TenantContext, entityId: string, day: FarmDay) {
  const [batches, items, saved] = await Promise.all([
    batchesForFinance(tx, ctx),
    stockOnDay(tx, ctx, day),
    tx.yearEndCount.findMany({ where: { organizationId: ctx.organizationId, legalEntityId: entityId, day: date(day) } }),
  ]);
  return { lines: countLines(day, batches, items, new Map(saved.map((s) => [s.subjectId, s.quantity]))), saved: new Map(saved.map((s) => [s.subjectId, s])) };
}

/** FCX4 (T103): once the year's close run has posted, its count is frozen. */
export const closePosted = async (tx: Tx, ctx: TenantContext, entityId: string, year: number) =>
  (await tx.journalEntry.count({ where: { organizationId: ctx.organizationId, sourceModule: "finance", sourceId: { in: CLOSE_KINDS.map((k) => closeSource(k, entityId, year)) } } })) > 0;

const yearIn = (y: number) => Number.isInteger(y) && y >= 2000 && y <= 2100;

/** FC3: the count sheet of a fiscal year (by the calendar year it ends in; the current one by default), per farm. */
export async function yearEndCount(ctx: TenantContext, year: number | null, clock: Clock = systemClock): Promise<Result<CountSheet, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN"); // owner, manager; the accountant reads (FCX1)
  const [entity] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation in M1
  if (!entity) return fail("NOT_FOUND");
  const y = year ?? countYearOf(farmDayOf(clock.now()), entity.fiscalYearStartMonth);
  if (!yearIn(y)) return fail("INVALID_INPUT");
  const day = countDay(y, entity.fiscalYearStartMonth);
  return ok(
    await db.$transaction(async (tx) => {
      const { lines } = await sheet(tx, ctx, entity.id, day);
      const frozen = await closePosted(tx, ctx, entity.id, y);
      const names = await placeNames(tx, ctx, [...new Set(lines.map((l) => l.farmId))]);
      const farms = [...new Set(lines.map((l) => l.farmId))].map((id) => ({ id, name: names.get(id) ?? "", lines: lines.filter((l) => l.farmId === id) }));
      return { year: y, day, frozen, farms: farms.sort((a, b) => a.name.localeCompare(b.name)) };
    }),
  );
}

export const SaveCount = z.object({ year: z.number().int(), counts: z.record(z.string(), z.string().trim().max(20)) });

/**
 * FC3: saves the quantities counted, typed in each line's unit; an empty one removes that line's count. Owner and
 * manager (FCX1), audited per line. Refused once the year's close run has posted (FCX4). Returns how many lines changed.
 */
export async function saveYearEndCount(ctx: TenantContext, input: unknown): Promise<Result<number, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "COUNT_FROZEN">> {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  const parsed = SaveCount.safeParse(input);
  if (!parsed.success || !yearIn(parsed.data.year)) return fail("INVALID_INPUT");
  const [entity] = await listLegalEntities(ctx);
  if (!entity) return fail("NOT_FOUND");
  const day = countDay(parsed.data.year, entity.fiscalYearStartMonth);
  return db.$transaction(async (tx): Promise<Result<number, "INVALID_INPUT" | "COUNT_FROZEN">> => {
    await legalEntityIn(tx, ctx, entity.id); // row-locked, as the close run: no run posts while the count is saved
    if (await closePosted(tx, ctx, entity.id, parsed.data.year)) return fail("COUNT_FROZEN");
    const { lines, saved } = await sheet(tx, ctx, entity.id, day);
    const byId = new Map(lines.map((l) => [l.id, l]));
    const changes: { line: CountLine; quantity: number | null }[] = [];
    for (const [id, text] of Object.entries(parsed.data.counts)) {
      const line = byId.get(id);
      if (!line) return fail("INVALID_INPUT"); // not on this organisation's sheet for that day
      const quantity = text === "" ? null : parseCounted(text, line);
      if (text !== "" && quantity === null) return fail("INVALID_INPUT");
      if (quantity !== line.counted) changes.push({ line, quantity });
    }
    for (const { line, quantity } of changes) {
      const before = saved.get(line.id);
      const row =
        quantity === null
          ? await tx.yearEndCount.delete({ where: { id: before!.id } }) // a count removed: it was there (quantity ≠ counted)
          : await tx.yearEndCount.upsert({
              where: { legalEntityId_day_subjectId: { legalEntityId: entity.id, day: date(day), subjectId: line.id } },
              create: { id: uuidv7(), organizationId: ctx.organizationId, legalEntityId: entity.id, day: date(day), kind: line.kind, subjectId: line.id, quantity, updatedBy: ctx.userId },
              update: { quantity, updatedBy: ctx.userId },
            });
      await audit(tx, ctx, {
        entity: "YearEndCount",
        entityId: row.id,
        action: quantity === null ? "delete" : before ? "update" : "create",
        before: before ? { day, subjectId: line.id, quantity: before.quantity } : null,
        after: quantity === null ? null : { day, subjectId: line.id, quantity },
      }); // a web action, not a sync mutation: no mutation id
    }
    return ok(changes.length);
  });
}
