import { withoutMoney } from "@/lib/permissions";
import { defineMutation, type SyncRegistry } from "@/lib/sync/server";
import { placeBatch } from "@/modules/flock/application/place-batch";
import { BATCH_MONEY, FLOCK_MUTATIONS as M, PlaceBatch, type BatchDto } from "@/modules/flock/schema";

// Offline flock writes. Owners and managers place batches (flock.manage); every member sees them, workers without the
// chick price (SPEC I5).
export const flockSync: SyncRegistry = {
  mutations: {
    [M.placeBatch]: defineMutation({ schema: PlaceBatch, action: "flock.manage", apply: (tx, ctx, cmd, meta) => placeBatch(tx, ctx, cmd, meta) }),
  },
  entities: { batch: (ctx, data: BatchDto) => withoutMoney(ctx, data, BATCH_MONEY) },
};
