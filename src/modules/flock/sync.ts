import { withoutMoney } from "@/lib/permissions";
import { defineMutation, type SyncRegistry } from "@/lib/sync/server";
import { placeBatch } from "@/modules/flock/application/place-batch";
import { recordDay } from "@/modules/flock/application/record-day";
import { recordWeighing } from "@/modules/flock/application/record-weighing";
import { BATCH_MONEY, FLOCK_MUTATIONS as M, PlaceBatch, RecordDay, RecordWeighing, type BatchDto, type DailyEntryDto, type WeighingDto } from "@/modules/flock/schema";

// Offline flock writes. Owners and managers place batches (flock.manage); every member sees them, workers without the
// chick price (SPEC I5).
export const flockSync: SyncRegistry = {
  mutations: {
    [M.placeBatch]: defineMutation({ schema: PlaceBatch, action: "flock.manage", apply: (tx, ctx, cmd, meta) => placeBatch(tx, ctx, cmd, meta) }),
    [M.recordDay]: defineMutation({ schema: RecordDay, action: "flock.record", apply: (tx, ctx, cmd, meta) => recordDay(tx, ctx, cmd, meta) }),
    [M.recordWeighing]: defineMutation({ schema: RecordWeighing, action: "flock.record", apply: (tx, ctx, cmd, meta) => recordWeighing(tx, ctx, cmd, meta) }),
  },
  entities: {
    batch: (ctx, data: BatchDto) => withoutMoney(ctx, data, BATCH_MONEY),
    dailyEntry: (_ctx, data: DailyEntryDto) => data, // no money in a daily entry
    weighing: (_ctx, data: WeighingDto) => data,
  },
};
