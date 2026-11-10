import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";

/** ADR-006: one append-only row per change, in the same transaction. Sync writes pass the mutation and device time. */
export function audit(
  tx: Tx,
  ctx: Pick<TenantContext, "userId" | "organizationId">,
  event: {
    entity: string;
    entityId: string;
    action: string;
    before?: object | null;
    after?: object | null;
    mutationId?: string;
    deviceCreatedAt?: Date;
  },
) {
  const { before, after, ...rest } = event;
  return tx.auditEvent.create({
    data: { organizationId: ctx.organizationId, userId: ctx.userId, ...rest, before: before ?? undefined, after: after ?? undefined },
  });
}
