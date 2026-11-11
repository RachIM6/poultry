import type { Tx } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import type { Reminder, VaccinationDto, VaccinationMethod } from "@/modules/health/schema";

// Vaccination repository (Prisma). Scoped to the caller's organisation, except the reminder job's claim.

const date = (day: string) => new Date(`${day}T00:00:00Z`); // a farm day, stored as a calendar date
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

type Row = {
  id: string;
  batchId: string;
  dayOfAge: number;
  dueOn: Date;
  productId: string;
  method: string;
  doneOn: Date | null;
  stockItemId: string | null;
  doses: number | null;
  doneMethod: string | null;
  doneBy: string | null;
};
const toDto = (r: Row): VaccinationDto => ({
  id: r.id,
  batchId: r.batchId,
  dayOfAge: r.dayOfAge,
  dueOn: dayOf(r.dueOn),
  productId: r.productId,
  method: r.method as VaccinationMethod,
  done: r.doneOn
    ? { on: dayOf(r.doneOn), stockItemId: r.stockItemId!, doses: r.doses!, method: r.doneMethod as VaccinationMethod, byUserId: r.doneBy! }
    : null,
});

export const batchHasPlan = async (tx: Tx, ctx: TenantContext, batchId: string) =>
  (await tx.vaccination.count({ where: { organizationId: ctx.organizationId, batchId } })) > 0;

export async function savePlan(tx: Tx, ctx: TenantContext, protocolId: string, plan: VaccinationDto[]) {
  await tx.vaccination.createMany({
    data: plan.map((v) => ({
      id: v.id,
      organizationId: ctx.organizationId,
      batchId: v.batchId,
      protocolId,
      dayOfAge: v.dayOfAge,
      dueOn: date(v.dueOn),
      productId: v.productId,
      method: v.method,
    })),
  });
}

export async function findVaccination(tx: Tx, ctx: TenantContext, id: string) {
  const r = await tx.vaccination.findFirst({ where: { id, organizationId: ctx.organizationId } });
  return r && toDto(r);
}

export async function saveDone(tx: Tx, id: string, done: NonNullable<VaccinationDto["done"]>) {
  const r = await tx.vaccination.update({
    where: { id },
    data: { doneOn: date(done.on), stockItemId: done.stockItemId, doses: done.doses, doneMethod: done.method, doneBy: done.byUserId },
  });
  return toDto(r);
}

export type ReminderRow = { id: string; organizationId: string; batchId: string; productId: string; dayOfAge: number; method: string };

/**
 * H2, for the reminder job, across organisations: marks the vaccinations not yet done, due on `dueOn`, whose `reminder`
 * hasn't gone out, and returns them. A row already claimed is skipped, also by a second job running at the same moment
 * (it waits on the row lock, then sees the column set), so each reminder goes out once.
 */
export function claimReminders(tx: Tx, reminder: Reminder, dueOn: FarmDay, now: Date) {
  return reminder === "dayBefore"
    ? tx.$queryRaw<ReminderRow[]>`
        UPDATE "Vaccination" SET "remindedBeforeAt" = ${now}
        WHERE "dueOn" = ${dueOn}::date AND "doneOn" IS NULL AND "remindedBeforeAt" IS NULL
        RETURNING id, "organizationId", "batchId", "productId", "dayOfAge", method`
    : tx.$queryRaw<ReminderRow[]>`
        UPDATE "Vaccination" SET "remindedDueAt" = ${now}
        WHERE "dueOn" = ${dueOn}::date AND "doneOn" IS NULL AND "remindedDueAt" IS NULL
        RETURNING id, "organizationId", "batchId", "productId", "dayOfAge", method`;
}
