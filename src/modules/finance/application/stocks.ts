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
import { stockOnDay, stockValueOnDay } from "@/modules/inventory";
import { closePosted } from "@/modules/finance/application/count";
import { countDay } from "@/modules/finance/domain/count";
import { stocksAtClose, yearEndProvision, yearEndStock, type StockAtClose } from "@/modules/finance/domain/stocks";
import type { Posting } from "@/modules/finance/domain/posting";

// SPEC-finance FC5 (T108): bought stock at the close. Reads inventory through its index; writes only YearEndValue.

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

/** The close run's "stock" kind (FCX4): D 31x / C the 6124 leaves. */
export const closeStock = async (tx: Tx, ctx: TenantContext, entity: LegalEntityDto, day: FarmDay): Promise<Posting | null> => yearEndStock(await stockLinesAtClose(tx, ctx, entity, day), entity.accountingProfile.overlays.includes("pca"));

/** The close run's "provision" kind (FCX4): D 6196 / C 3912 for the stock lines below cost. */
export const closeProvision = async (tx: Tx, ctx: TenantContext, entity: LegalEntityDto, day: FarmDay): Promise<Posting | null> => yearEndProvision(await stockLinesAtClose(tx, ctx, entity, day));

const yearIn = (y: number) => Number.isInteger(y) && y >= 2000 && y <= 2100;

export const SaveValues = z.object({ year: z.number().int(), values: z.record(z.string(), z.string().trim().max(20)) });

/**
 * FC5, FQ20: saves the owner's current value of stock lines (the whole line, in dirhams); an empty one removes it, so
 * the line is at cost again. Only a line valued at cost takes one. Owner only, audited per line. Refused once the
 * year's close run has posted, as the count (FCX4). Returns how many lines changed.
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
    if (await closePosted(tx, ctx, entity.id, parsed.data.year)) return fail("COUNT_FROZEN");
    const day = countDay(parsed.data.year, entity.fiscalYearStartMonth);
    const lines = new Map((await stockLinesAtClose(tx, ctx, entity, day)).map((l) => [l.id, l]));
    const changes: { id: string; value: bigint | null }[] = [];
    for (const [id, text] of Object.entries(parsed.data.values)) {
      const line = lines.get(id);
      if (!line || line.cost === null) return fail("INVALID_INPUT"); // not a valued line of this organisation's stock
      const value = text === "" ? null : parseCentimes(text);
      if (text !== "" && value === null) return fail("INVALID_INPUT");
      if (value !== line.current) changes.push({ id, value });
    }
    for (const { id, value } of changes) {
      const key = { legalEntityId_day_subjectId: { legalEntityId: entity.id, day: date(day), subjectId: id } };
      const before = await tx.yearEndValue.findUnique({ where: key });
      const row =
        value === null
          ? await tx.yearEndValue.delete({ where: key }) // removed: it was there (value ≠ current)
          : await tx.yearEndValue.upsert({
              where: key,
              create: { id: uuidv7(), organizationId: ctx.organizationId, legalEntityId: entity.id, day: date(day), kind: "stock", subjectId: id, valueCentimes: value, updatedBy: ctx.userId },
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
