import { audit } from "@/lib/audit";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { latestRecordableDay } from "@/lib/kernel/farm-day";
import { fail, ok } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import { PRICE_MUTATIONS as M, RecordPrice, type PriceDto } from "@/modules/market-prices/schema";

// SPEC-m5 §6: the farm's own price log, written offline. Light module: Prisma and rules here. Nothing leaves the
// organisation (MP3, NQ2).

const clock: Clock = systemClock;

export const marketPricesSync: SyncRegistry = {
  mutations: {
    // MP1: recorded once, never edited; a wrong price is followed by the right one.
    [M.recordPrice]: defineMutation({
      schema: RecordPrice,
      action: "prices.record",
      async apply(tx, ctx, p, meta) {
        if (p.day > latestRecordableDay(clock)) return fail("DAY_IN_FUTURE");
        if (await tx.priceObservation.findUnique({ where: { id: p.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        const dto: PriceDto = { ...p, byUserId: ctx.userId };
        await tx.priceObservation.create({ data: { ...dto, day: new Date(`${p.day}T00:00:00Z`), priceCentimes: BigInt(p.priceCentimes), organizationId: ctx.organizationId } });
        await recordChange(tx, ctx, "price", p.id, dto);
        await audit(tx, ctx, { entity: "PriceObservation", entityId: p.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
  },
  // Prices are money (SPEC I5): never on a worker's phone.
  entities: { price: (ctx, data: PriceDto) => (can(ctx, "money.read") ? data : undefined) },
};
