import type { z } from "zod";
import { audit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { fail, ok } from "@/lib/kernel/result";
import { recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { batchFacts } from "@/modules/flock";
import { checkAdd, checkEdit, moveLine, movedWithPlacement } from "@/modules/health/domain/plan-edit";
import { deleteLine, findVaccination, saveLine, saveMove, undoneLines, vaccinationIdTaken } from "@/modules/health/infrastructure/vaccinations";
import type { AddVaccination, CancelVaccination, MoveVaccination, VaccinationDto } from "@/modules/health/schema";
import { areVaccines } from "@/modules/reference-data";

// SPEC H1 + SPEC-m5 PA4, applied by the sync push: the vet (or the owner, a manager) edits a batch's plan. A line given
// stays as recorded (H2, H6). The reminder job reads the plan as it is, so a moved line is announced for its new day
// and a cancelled one not at all (H2).

type Meta = { mutationId: string; deviceCreatedAt: Date };

/** A vaccine of the catalogue on a day of age, added by hand to the batch's plan. */
export async function addVaccination(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof AddVaccination>, meta: Meta) {
  const batch = await batchFacts(tx, ctx, cmd.batchId);
  if (!batch) return fail("NOT_FOUND");
  if (await vaccinationIdTaken(tx, cmd.id)) return fail("ALREADY_EXISTS");
  if (!(await areVaccines(tx, [cmd.productId]))) return fail("INVALID_INPUT");
  const dueOn = checkAdd(batch, cmd.dayOfAge);
  if (!dueOn.ok) return dueOn;

  const dto: VaccinationDto = { id: cmd.id, batchId: cmd.batchId, dayOfAge: cmd.dayOfAge, dueOn: dueOn.value, productId: cmd.productId, method: cmd.method, done: null };
  await saveLine(tx, ctx, dto);
  await recordChange(tx, ctx, "vaccination", dto.id, dto);
  await audit(tx, ctx, { entity: "Vaccination", entityId: dto.id, action: "add", after: dto, ...meta });
  return ok(undefined);
}

/** A line not yet done, moved to another day of age. */
export async function moveVaccination(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof MoveVaccination>, meta: Meta) {
  const line = await findVaccination(tx, ctx, cmd.id);
  const batch = line && (await batchFacts(tx, ctx, line.batchId));
  if (!line || !batch) return fail("NOT_FOUND");
  const moved = moveLine(line, batch, cmd.dayOfAge);
  if (!moved.ok) return moved;

  const dto = await saveMove(tx, ctx, line.id, moved.value);
  if (!dto) return fail("ALREADY_DONE"); // given on another phone since it was read
  await recordChange(tx, ctx, "vaccination", dto.id, dto);
  await audit(tx, ctx, { entity: "Vaccination", entityId: dto.id, action: "move", before: { dayOfAge: line.dayOfAge, dueOn: line.dueOn }, after: { dayOfAge: dto.dayOfAge, dueOn: dto.dueOn }, ...meta });
  return ok(undefined);
}

/** A line not yet done, taken out of the plan. The audit keeps what it was. */
export async function cancelVaccination(tx: Tx, ctx: TenantContext, cmd: z.infer<typeof CancelVaccination>, meta: Meta) {
  const line = await findVaccination(tx, ctx, cmd.id);
  const batch = line && (await batchFacts(tx, ctx, line.batchId));
  if (!line || !batch) return fail("NOT_FOUND");
  const editable = checkEdit(line, batch);
  if (!editable.ok) return editable;

  if (!(await deleteLine(tx, ctx, line.id))) return fail("ALREADY_DONE"); // given on another phone since it was read
  await recordChange(tx, ctx, "vaccination", line.id, null);
  await audit(tx, ctx, { entity: "Vaccination", entityId: line.id, action: "cancel", before: line, ...meta });
  return ok(undefined);
}

/**
 * SPEC B1, right after flock corrected the batch's placement day, in the same transaction (flock may not call health,
 * so the sync registry chains the two). Each line not yet done moves with the placement and is announced again for its
 * new day (H2); a line given keeps its day.
 */
export async function moveWithPlacement(tx: Tx, ctx: TenantContext, batchId: string, meta: Meta) {
  const batch = await batchFacts(tx, ctx, batchId);
  if (!batch) throw new Error(`batch ${batchId} not found right after its correction`); // a programming error: roll back
  const lines = await undoneLines(tx, ctx, batchId);
  for (const line of movedWithPlacement(lines, batch)) {
    const dto = await saveMove(tx, ctx, line.id, { dayOfAge: line.dayOfAge, dueOn: line.dueOn, remindAgain: true });
    if (!dto) continue; // given on another phone since it was read: it keeps its day
    await recordChange(tx, ctx, "vaccination", dto.id, dto);
    const before = lines.find((l) => l.id === line.id)!;
    await audit(tx, ctx, { entity: "Vaccination", entityId: dto.id, action: "move", before: { dayOfAge: before.dayOfAge, dueOn: before.dueOn }, after: { dayOfAge: dto.dayOfAge, dueOn: dto.dueOn }, ...meta });
  }
  return ok(undefined);
}
