import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/kernel/result";
import { withoutMoney } from "@/lib/permissions";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import { farmBelongsTo, houseOf, placeBatch } from "@/modules/flock";
import { CancelPlan, checkDowntimeRule, PlaceFromPlan, PLANNING_MUTATIONS as M, SaveDowntime, SavePlan, type DowntimeRule, type PlanDto } from "@/modules/planning/schema";

// SPEC-m5 §7: planned batches and the farm's minimum downtime, written offline. Light module: Prisma and rules here;
// the planner's rules (sale day, gaps, overlaps) are in domain/ because the phone runs them too.

const date = (d: string) => new Date(`${d}T00:00:00Z`); // a calendar date
const iso = (d: Date) => d.toISOString().slice(0, 10);
type PlanRow = Omit<PlanDto, "placeOn" | "chickPriceCentimes" | "status"> & { placeOn: Date; chickPriceCentimes: bigint | null; status: string };
export const planDto = (r: PlanRow): PlanDto => ({
  id: r.id,
  farmId: r.farmId,
  houseId: r.houseId,
  placeOn: iso(r.placeOn),
  chicks: r.chicks,
  strainId: r.strainId,
  hatchery: r.hatchery,
  chickPriceCentimes: r.chickPriceCentimes === null ? null : String(r.chickPriceCentimes),
  saleAge: r.saleAge,
  status: r.status as PlanDto["status"],
  batchId: r.batchId,
});

export const planningSync: SyncRegistry = {
  mutations: {
    // PL1: the owner or a manager, who also place batches. Edited only while planned.
    [M.savePlan]: defineMutation({
      schema: SavePlan,
      action: "flock.manage",
      async apply(tx, ctx, p, meta) {
        const house = await houseOf(tx, ctx, p.houseId);
        if (!house) return fail("NOT_FOUND");
        const before = await tx.plannedBatch.findUnique({ where: { id: p.id } });
        if (before && before.organizationId !== ctx.organizationId) return fail("NOT_FOUND");
        if (before && before.status !== "planned") return fail("ALREADY_DONE");
        const data = { ...p, farmId: house.farmId, placeOn: date(p.placeOn), chickPriceCentimes: p.chickPriceCentimes === null ? null : BigInt(p.chickPriceCentimes) };
        const row = before
          ? await tx.plannedBatch.update({ where: { id: p.id }, data })
          : await tx.plannedBatch.create({ data: { ...data, status: "planned", organizationId: ctx.organizationId, createdBy: ctx.userId } });
        const dto = planDto(row);
        await recordChange(tx, ctx, "plannedBatch", dto.id, dto);
        await audit(tx, ctx, { entity: "PlannedBatch", entityId: dto.id, action: before ? "update" : "create", before: before ? planDto(before) : undefined, after: dto, ...meta });
        return ok(undefined);
      },
    }),
    // PL1: cancelled rather than deleted, so the plan's history stays.
    [M.cancelPlan]: defineMutation({
      schema: CancelPlan,
      action: "flock.manage",
      async apply(tx, ctx, { id }, meta) {
        const before = await tx.plannedBatch.findFirst({ where: { id, organizationId: ctx.organizationId } });
        if (!before) return fail("NOT_FOUND");
        if (before.status !== "planned") return fail("ALREADY_DONE");
        const dto = planDto(await tx.plannedBatch.update({ where: { id }, data: { status: "cancelled" } }));
        await recordChange(tx, ctx, "plannedBatch", id, dto);
        await audit(tx, ctx, { entity: "PlannedBatch", entityId: id, action: "cancel", before: planDto(before), after: dto, ...meta });
        return ok(undefined);
      },
    }),
    // PL3: one mutation places the batch (flock's rules) and marks the plan placed; placing twice places one batch.
    [M.placeFromPlan]: defineMutation({
      schema: PlaceFromPlan,
      action: "flock.manage",
      async apply(tx, ctx, { planId, batch }, meta) {
        const before = await tx.plannedBatch.findFirst({ where: { id: planId, organizationId: ctx.organizationId } });
        if (!before) return fail("NOT_FOUND");
        if (before.status !== "planned") return fail("ALREADY_DONE");
        if (batch.houseId !== before.houseId) return fail("INVALID_INPUT");
        const placed = await placeBatch(tx, ctx, batch, meta);
        if (!placed.ok) return placed;
        const dto = planDto(await tx.plannedBatch.update({ where: { id: planId }, data: { status: "placed", batchId: batch.id } }));
        await recordChange(tx, ctx, "plannedBatch", planId, dto);
        await audit(tx, ctx, { entity: "PlannedBatch", entityId: planId, action: "place", before: planDto(before), after: dto, ...meta });
        return ok(undefined);
      },
    }),
    // PL5, §2: a figure above the official one, from the owner's source (CQ3, NQ4).
    [M.saveDowntime]: defineMutation({
      schema: SaveDowntime,
      action: "organization.manage",
      async apply(tx, ctx, r, meta) {
        if (!(await farmBelongsTo(tx, ctx, r.farmId))) return fail("NOT_FOUND");
        const checked = checkDowntimeRule(r);
        if (!checked.ok) return checked;
        if (await tx.downtimeRule.findUnique({ where: { id: r.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        await tx.downtimeRule.create({ data: { ...r, validFrom: date(r.validFrom), organizationId: ctx.organizationId, createdBy: ctx.userId } });
        const dto: DowntimeRule = r;
        await recordChange(tx, ctx, "downtimeRule", r.id, dto);
        await audit(tx, ctx, { entity: "DowntimeRule", entityId: r.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
  },
  entities: {
    plannedBatch: (ctx, data: PlanDto) => withoutMoney(ctx, data, ["chickPriceCentimes"]), // the booked price is money
    downtimeRule: (_ctx, data: DowntimeRule) => data,
  },
};
