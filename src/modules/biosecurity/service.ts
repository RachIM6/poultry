import type { Disposal, ManureRemoval, RodentCheck, Visit } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import {
  BIOSECURITY_MUTATIONS as M,
  EditCleanoutStep,
  EditDisposal,
  EditManure,
  EditRodentCheck,
  EditVisit,
  RecordCleanoutStep,
  RecordDisposal,
  RecordManure,
  RecordRodentCheck,
  RecordVisit,
  StartCleanout,
  checkDisposal,
  checkStep,
  type CleanoutDto,
  type CleanoutStepDto,
  type CleanoutStepKey,
  visitZone,
  type DisposalDto,
  type ManureRemovalDto,
  type RodentCheckDto,
  type VisitDto,
} from "@/modules/biosecurity/schema";
import { farmBelongsTo, houseOf } from "@/modules/farm-registry";
import { batchFacts } from "@/modules/flock";

// SPEC-m2-compliance §4, light module: the logs a farm keeps on the phone, applied by POST /api/sync/push.
// Records are never deleted (D6): they are the evidence an inspection asks for.

const day = (d: string) => new Date(`${d}T00:00:00Z`); // a calendar date
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const days = <C extends { day?: string }>(c: C) => ({ ...c, day: c.day === undefined ? undefined : day(c.day) }); // a change's columns

// Rows as the phone stores them.
type StepRow = { id: string; step: string; day: Date; product: string | null; dose: string | null; productLot: string | null; note: string | null };
const stepDto = (s: StepRow): CleanoutStepDto => ({ id: s.id, step: s.step as CleanoutStepKey, day: dayOf(s.day), product: s.product, dose: s.dose, productLot: s.productLot, note: s.note });
const visitDto = (v: Visit): VisitDto => ({
  id: v.id,
  farmId: v.farmId,
  enteredAt: v.enteredAt.toISOString(),
  visitor: v.visitor,
  vehicle: v.vehicle,
  purpose: v.purpose as VisitDto["purpose"],
  recentFarm: v.recentFarm,
  wheelsDisinfected: v.wheelsDisinfected,
  footbath: v.footbath,
  farmClothing: v.farmClothing,
  zone: v.zone as VisitDto["zone"],
});
const disposalDto = (d: Disposal): DisposalDto => ({ id: d.id, farmId: d.farmId, day: dayOf(d.day), batchId: d.batchId, birds: d.birds, weightGrams: d.weightGrams, method: d.method as DisposalDto["method"], methodNote: d.methodNote });
const manureDto = (m: ManureRemoval): ManureRemovalDto => ({
  id: m.id,
  farmId: m.farmId,
  day: dayOf(m.day),
  houseId: m.houseId,
  batchId: m.batchId,
  quantityKg: m.quantityKg,
  destination: m.destination as ManureRemovalDto["destination"],
  recipient: m.recipient,
});
const rodentDto = (r: RodentCheck): RodentCheckDto => ({ id: r.id, farmId: r.farmId, houseId: r.houseId, day: dayOf(r.day), action: r.action as RodentCheckDto["action"], product: r.product, proofFileId: r.proofFileId });

/** D6: what a correction overwrote, for the audit's `before`. */
const overwritten = (before: object, changes: object) => Object.fromEntries(Object.keys(changes).map((k) => [k, before[k as keyof typeof before]]));

/** The clean-out as the phone stores it: header and steps in one record. */
async function cleanoutDto(tx: Tx, id: string): Promise<CleanoutDto> {
  const c = await tx.cleanout.findUniqueOrThrow({ where: { id }, include: { steps: { orderBy: { id: "asc" } } } });
  return { id: c.id, farmId: c.farmId, houseId: c.houseId, afterBatchId: c.afterBatchId, startedOn: dayOf(c.startedOn), steps: c.steps.map(stepDto) };
}

/** The farm, and the house and batch when given, are the caller's organisation's and belong together. */
async function placeOf(tx: Tx, ctx: TenantContext, r: { farmId: string; houseId?: string | null; batchId?: string | null }): Promise<Result<void>> {
  if (!(await farmBelongsTo(tx, ctx, r.farmId))) return fail("NOT_FOUND");
  if (r.houseId && (await houseOf(tx, ctx, r.houseId))?.farmId !== r.farmId) return fail("NOT_FOUND");
  if (r.batchId) {
    const batch = await batchFacts(tx, ctx, r.batchId);
    if (batch?.farmId !== r.farmId || (r.houseId && batch.houseId !== r.houseId)) return fail("NOT_FOUND");
  }
  return ok(undefined);
}

export const biosecuritySync: SyncRegistry = {
  mutations: {
    [M.recordVisit]: defineMutation({
      schema: RecordVisit,
      action: "biosecurity.record",
      async apply(tx, ctx, { id, farmId, enteredAt, ...fields }, meta) {
        if (!(await farmBelongsTo(tx, ctx, farmId))) return fail("NOT_FOUND");
        const zone = visitZone(fields);
        if (!zone.ok) return zone;
        if (await tx.visit.findUnique({ where: { id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        await tx.visit.create({ data: { id, organizationId: ctx.organizationId, farmId, enteredAt: new Date(enteredAt), ...fields, recordedBy: ctx.userId } });
        const dto: VisitDto = { id, farmId, enteredAt, ...fields };
        await recordChange(tx, ctx, "visit", id, dto);
        await audit(tx, ctx, { entity: "Visit", entityId: id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    [M.recordDisposal]: defineMutation({
      schema: RecordDisposal,
      action: "biosecurity.record",
      async apply(tx, ctx, dto: DisposalDto, meta) {
        const place = await placeOf(tx, ctx, dto);
        if (!place.ok) return place;
        const checked = checkDisposal(dto);
        if (!checked.ok) return checked;
        if (await tx.disposal.findUnique({ where: { id: dto.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        await tx.disposal.create({ data: { ...dto, organizationId: ctx.organizationId, day: day(dto.day), recordedBy: ctx.userId } });
        await recordChange(tx, ctx, "disposal", dto.id, dto);
        await audit(tx, ctx, { entity: "Disposal", entityId: dto.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    [M.recordManure]: defineMutation({
      schema: RecordManure,
      action: "biosecurity.record",
      async apply(tx, ctx, dto: ManureRemovalDto, meta) {
        const place = await placeOf(tx, ctx, dto);
        if (!place.ok) return place;
        if (await tx.manureRemoval.findUnique({ where: { id: dto.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        await tx.manureRemoval.create({ data: { ...dto, organizationId: ctx.organizationId, day: day(dto.day), recordedBy: ctx.userId } });
        await recordChange(tx, ctx, "manureRemoval", dto.id, dto);
        await audit(tx, ctx, { entity: "ManureRemoval", entityId: dto.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    // BS4: after the house's batch has closed, once per batch.
    [M.startCleanout]: defineMutation({
      schema: StartCleanout,
      action: "biosecurity.record",
      async apply(tx, ctx, { id, houseId, afterBatchId, startedOn }, meta) {
        const house = await houseOf(tx, ctx, houseId);
        const batch = await batchFacts(tx, ctx, afterBatchId);
        if (!house || !batch || batch.houseId !== houseId) return fail("NOT_FOUND"); // the batch that left this house
        if (batch.status !== "closed") return fail("BATCH_NOT_CLOSED");
        if (await tx.cleanout.findFirst({ where: { OR: [{ id }, { afterBatchId }] }, select: { id: true } })) return fail("CLEANOUT_ALREADY_STARTED");
        await tx.cleanout.create({ data: { id, organizationId: ctx.organizationId, farmId: house.farmId, houseId, afterBatchId, startedOn: day(startedOn), startedBy: ctx.userId } });
        const dto = await cleanoutDto(tx, id);
        await recordChange(tx, ctx, "cleanout", id, dto);
        await audit(tx, ctx, { entity: "Cleanout", entityId: id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    [M.recordCleanoutStep]: defineMutation({
      schema: RecordCleanoutStep,
      action: "biosecurity.record",
      async apply(tx, ctx, { cleanoutId, ...step }, meta) {
        if (!(await tx.cleanout.findFirst({ where: { id: cleanoutId, organizationId: ctx.organizationId }, select: { id: true } }))) return fail("NOT_FOUND");
        const before = await cleanoutDto(tx, cleanoutId);
        const checked = checkStep(before.steps, step);
        if (!checked.ok) return checked;
        await tx.cleanoutStep.create({ data: { ...step, cleanoutId, day: day(step.day), recordedBy: ctx.userId } });
        await recordChange(tx, ctx, "cleanout", cleanoutId, await cleanoutDto(tx, cleanoutId));
        await audit(tx, ctx, { entity: "CleanoutStep", entityId: step.id, action: "create", after: { cleanoutId, ...step }, ...meta });
        return ok(undefined);
      },
    }),
    [M.recordRodentCheck]: defineMutation({
      schema: RecordRodentCheck,
      action: "biosecurity.record",
      async apply(tx, ctx, fields, meta) {
        const place = await placeOf(tx, ctx, fields);
        if (!place.ok) return place;
        if (await tx.rodentCheck.findUnique({ where: { id: fields.id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        await tx.rodentCheck.create({ data: { ...fields, organizationId: ctx.organizationId, day: day(fields.day), recordedBy: ctx.userId } });
        const dto: RodentCheckDto = { ...fields, proofFileId: null };
        await recordChange(tx, ctx, "rodentCheck", dto.id, dto);
        await audit(tx, ctx, { entity: "RodentCheck", entityId: dto.id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),

    // D6: corrections. Whoever may record may correct (BS9); the corrected record is re-checked like a new one, and
    // the audit keeps what it overwrote. The register and the inspection pack print the record as corrected.
    [M.editVisit]: defineMutation({
      schema: EditVisit,
      action: "biosecurity.record",
      async apply(tx, ctx, { id, changes }, meta) {
        const row = await tx.visit.findFirst({ where: { id, organizationId: ctx.organizationId } });
        if (!row) return fail("NOT_FOUND");
        const before = visitDto(row);
        const dto = { ...before, ...changes };
        const zone = visitZone(dto);
        if (!zone.ok) return zone;
        await tx.visit.update({ where: { id }, data: changes });
        await recordChange(tx, ctx, "visit", id, dto);
        await audit(tx, ctx, { entity: "Visit", entityId: id, action: "update", before: overwritten(before, changes), after: changes, ...meta });
        return ok(undefined);
      },
    }),
    [M.editDisposal]: defineMutation({
      schema: EditDisposal,
      action: "biosecurity.record",
      async apply(tx, ctx, { id, changes }, meta) {
        const row = await tx.disposal.findFirst({ where: { id, organizationId: ctx.organizationId } });
        if (!row) return fail("NOT_FOUND");
        const before = disposalDto(row);
        const dto = { ...before, ...changes };
        const place = await placeOf(tx, ctx, dto);
        if (!place.ok) return place;
        const checked = checkDisposal(dto);
        if (!checked.ok) return checked;
        await tx.disposal.update({ where: { id }, data: days(changes) });
        await recordChange(tx, ctx, "disposal", id, dto);
        await audit(tx, ctx, { entity: "Disposal", entityId: id, action: "update", before: overwritten(before, changes), after: changes, ...meta });
        return ok(undefined);
      },
    }),
    [M.editManure]: defineMutation({
      schema: EditManure,
      action: "biosecurity.record",
      async apply(tx, ctx, { id, changes }, meta) {
        const row = await tx.manureRemoval.findFirst({ where: { id, organizationId: ctx.organizationId } });
        if (!row) return fail("NOT_FOUND");
        const before = manureDto(row);
        const dto = { ...before, ...changes };
        const place = await placeOf(tx, ctx, dto);
        if (!place.ok) return place;
        await tx.manureRemoval.update({ where: { id }, data: days(changes) });
        await recordChange(tx, ctx, "manureRemoval", id, dto);
        await audit(tx, ctx, { entity: "ManureRemoval", entityId: id, action: "update", before: overwritten(before, changes), after: changes, ...meta });
        return ok(undefined);
      },
    }),
    [M.editRodentCheck]: defineMutation({
      schema: EditRodentCheck,
      action: "biosecurity.record",
      async apply(tx, ctx, { id, changes }, meta) {
        const row = await tx.rodentCheck.findFirst({ where: { id, organizationId: ctx.organizationId } });
        if (!row) return fail("NOT_FOUND");
        const before = rodentDto(row);
        const dto = { ...before, ...changes };
        const place = await placeOf(tx, ctx, dto);
        if (!place.ok) return place;
        await tx.rodentCheck.update({ where: { id }, data: days(changes) });
        await recordChange(tx, ctx, "rodentCheck", id, dto);
        await audit(tx, ctx, { entity: "RodentCheck", entityId: id, action: "update", before: overwritten(before, changes), after: changes, ...meta });
        return ok(undefined);
      },
    }),
    [M.editCleanoutStep]: defineMutation({
      schema: EditCleanoutStep,
      action: "biosecurity.record",
      async apply(tx, ctx, { id, changes }, meta) {
        const row = await tx.cleanoutStep.findFirst({ where: { id, cleanout: { organizationId: ctx.organizationId } } });
        if (!row) return fail("NOT_FOUND");
        const before = stepDto(row);
        const checked = checkStep([], { ...before, ...changes }); // its kind is unchanged: only the disinfectant is re-checked
        if (!checked.ok) return checked;
        await tx.cleanoutStep.update({ where: { id }, data: days(changes) });
        await recordChange(tx, ctx, "cleanout", row.cleanoutId, await cleanoutDto(tx, row.cleanoutId));
        await audit(tx, ctx, { entity: "CleanoutStep", entityId: id, action: "update", before: overwritten(before, changes), after: changes, ...meta });
        return ok(undefined);
      },
    }),
  },
  // No money in these logs: every member sees them.
  entities: {
    visit: (_ctx, data: VisitDto) => data,
    disposal: (_ctx, data: DisposalDto) => data,
    manureRemoval: (_ctx, data: ManureRemovalDto) => data,
    cleanout: (_ctx, data: CleanoutDto) => data,
    rodentCheck: (_ctx, data: RodentCheckDto) => data,
  },
};

/**
 * BS8: attaches the proof photo the upload route has just stored for this organisation, once. A proof is never
 * replaced: a new check gets a new photo.
 */
export async function attachRodentProof(ctx: TenantContext, checkId: string, fileId: string): Promise<Result<void>> {
  if (!can(ctx, "biosecurity.record")) return fail("FORBIDDEN");
  return db.$transaction(async (tx) => {
    // Conditional update: of two uploads at once, only the first attaches (the row is locked by the first update).
    const { count } = await tx.rodentCheck.updateMany({ where: { id: checkId, organizationId: ctx.organizationId, proofFileId: null }, data: { proofFileId: fileId } });
    const row = await tx.rodentCheck.findFirst({ where: { id: checkId, organizationId: ctx.organizationId } });
    if (!row) return fail("NOT_FOUND");
    if (count === 0) return fail("PROOF_ALREADY_ATTACHED");
    await recordChange(tx, ctx, "rodentCheck", checkId, rodentDto(row));
    await audit(tx, ctx, { entity: "RodentCheck", entityId: checkId, action: "update", before: { proofFileId: null }, after: { proofFileId: fileId } });
    return ok(undefined);
  });
}
