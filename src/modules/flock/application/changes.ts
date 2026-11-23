import type { Tx } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import type { BatchDto } from "@/modules/flock/shared";

// species, fromBatchId: SPEC-finance FC6 (point-of-lay hens bought, the transfer to lay of SPEC-m3 B13)
export type PlacementChange = { version: bigint; id: string; farmId: string; placedOn: FarmDay; chicksCentimes: bigint; species: string; fromBatchId: string | null };

/**
 * For finance (SPEC-finance FN7): batches placed or changed after `after` (this organisation's change-log version),
 * oldest first, with what their chicks cost: every chick placed, dead on arrival included (as the B6 cost).
 */
export async function placementsChangedSince(tx: Tx, ctx: TenantContext, after: bigint, limit = 500): Promise<PlacementChange[]> {
  const changes = await tx.change.findMany({
    where: { organizationId: ctx.organizationId, entity: "batch", version: { gt: after } },
    orderBy: { version: "asc" },
    take: limit,
  });
  return changes
    .filter((c) => c.data !== null)
    .map((c) => {
      const b = c.data as unknown as BatchDto;
      return { version: c.version, id: b.id, farmId: b.farmId, placedOn: b.placedOn as FarmDay, chicksCentimes: BigInt(b.chicksPlaced) * BigInt(b.chickUnitPriceCentimes ?? "0"), species: b.species, fromBatchId: b.fromBatchId ?? null };
    });
}
