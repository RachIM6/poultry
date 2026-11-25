import { fail, type Result } from "@/lib/kernel/result";
import { TRANSFER_REASON, canJoinHouse } from "@/modules/flock/domain/batch";
import type { BirdSex, ProductionType } from "@/modules/reference-data/shared";

// SPEC B6 "Reopening" (decided default, to review): the owner reopens a closed batch to fix a wrong last sale, a missed
// mortality or a late cost. Its own file, out of batch.ts: /batches has no room to grow (SPEC §9.3); this one comes
// with the reopen form's chunk. The server and the phone run it; finance's period lock is the server's (it holds it).

export type ReopenError = "BATCH_NOT_CLOSED" | "BATCH_TRANSFERRED" | "HOUSE_HAS_NEWER_BATCH" | "HOUSE_HAS_OPEN_BATCH";

type Closed = { id: string; houseId: string; species: ProductionType; sex?: BirdSex; status: string; closedOn?: string | null; closeReason?: string | null };
type InHouse = { id: string; houseId: string; species: ProductionType; sex?: BirdSex; status: string; placedOn: string };

/**
 * May this closed batch open again, with `batches` the other batches (any house: those of its own count)? Not a pullet
 * batch moved to laying (its hens live on in the layer batch, SPEC-m3 B13); not once its house took a batch placed on
 * or after its closing day (the house was free then, and that batch's days would overlap its own); and the house must
 * take it back as a new placement (one open batch per house, SPEC-m3 B8, B9).
 */
export function checkReopen(batch: Closed, batches: readonly InHouse[]): Result<void, ReopenError> {
  if (batch.status !== "closed" || !batch.closedOn) return fail("BATCH_NOT_CLOSED");
  if (batch.closeReason === TRANSFER_REASON) return fail("BATCH_TRANSFERRED");
  const house = batches.filter((b) => b.id !== batch.id && b.houseId === batch.houseId);
  if (house.some((b) => b.placedOn >= batch.closedOn!)) return fail("HOUSE_HAS_NEWER_BATCH");
  return canJoinHouse(batch.species, house.filter((b) => b.status === "open"), batch.sex);
}
