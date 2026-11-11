import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { WeighingDto } from "@/modules/flock/schema";

// Weighing repository (Prisma). Weighings belong to the Batch aggregate; only flock's use cases call this.

export const weighingIdTaken = async (tx: Tx, id: string) => (await tx.weighing.count({ where: { id } })) > 0;

export async function saveWeighing(tx: Tx, ctx: TenantContext, w: WeighingDto): Promise<WeighingDto> {
  await tx.weighing.create({ data: { ...w, day: new Date(`${w.day}T00:00:00Z`), organizationId: ctx.organizationId } });
  return w;
}
