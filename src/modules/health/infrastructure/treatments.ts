import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { TreatmentDto, VetVisitDto } from "@/modules/health/schema";

// Treatment and vet visit repository (Prisma). Rows are written once and never edited (H6).

const date = (day: string) => new Date(`${day}T00:00:00Z`); // a farm day, stored as a calendar date

export const treatmentIdTaken = async (tx: Tx, id: string) => (await tx.treatment.count({ where: { id } })) > 0;
export const visitIdTaken = async (tx: Tx, id: string) => (await tx.vetVisit.count({ where: { id } })) > 0;

export async function saveTreatment(tx: Tx, ctx: TenantContext, t: TreatmentDto) {
  const { byUserId, ...rest } = t;
  await tx.treatment.create({
    data: {
      ...rest,
      organizationId: ctx.organizationId,
      startOn: date(t.startOn),
      endOn: date(t.endOn),
      withdrawalEndsOn: date(t.withdrawalEndsOn),
      recordedBy: byUserId,
    },
  });
}

export async function saveVisit(tx: Tx, ctx: TenantContext, v: VetVisitDto) {
  const { byUserId, ...rest } = v;
  await tx.vetVisit.create({ data: { ...rest, organizationId: ctx.organizationId, on: date(v.on), recordedBy: byUserId } });
}
