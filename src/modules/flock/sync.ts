import { withoutMoney } from "@/lib/permissions";
import { defineMutation, type SyncRegistry } from "@/lib/sync/server";
import { closeBatch, recordBatchCost } from "@/modules/flock/application/close-batch";
import { correctPlacement } from "@/modules/flock/application/correct-placement";
import { placeBatch } from "@/modules/flock/application/place-batch";
import { recordDay } from "@/modules/flock/application/record-day";
import { recordWeighing } from "@/modules/flock/application/record-weighing";
import { reopenBatch } from "@/modules/flock/application/reopen-batch";
import { transferToLaying } from "@/modules/flock/application/transfer";
import {
  BATCH_MONEY,
  CloseBatch,
  CorrectPlacement,
  FLOCK_MUTATIONS as M,
  PlaceBatch,
  RecordBatchCost,
  RecordDay,
  RecordWeighing,
  ReopenBatch,
  TransferToLaying,
  type BatchCostDto,
  type BatchDto,
  type DailyEntryDto,
  type SoldBirdsDto,
  type WeighingDto,
} from "@/modules/flock/schema";

// Offline flock writes. Owners and managers place batches (flock.manage); every member sees them, workers without the
// chick price (SPEC I5).
export const flockSync: SyncRegistry = {
  mutations: {
    [M.placeBatch]: defineMutation({ schema: PlaceBatch, action: "flock.manage", apply: (tx, ctx, cmd, meta) => placeBatch(tx, ctx, cmd, meta) }),
    [M.recordDay]: defineMutation({ schema: RecordDay, action: "flock.record", apply: (tx, ctx, cmd, meta) => recordDay(tx, ctx, cmd, meta) }),
    [M.recordWeighing]: defineMutation({ schema: RecordWeighing, action: "flock.record", apply: (tx, ctx, cmd, meta) => recordWeighing(tx, ctx, cmd, meta) }),
    [M.correctPlacement]: defineMutation({ schema: CorrectPlacement, action: "flock.manage", apply: (tx, ctx, cmd, meta) => correctPlacement(tx, ctx, cmd, meta) }),
    [M.closeBatch]: defineMutation({ schema: CloseBatch, action: "flock.manage", apply: (tx, ctx, cmd, meta) => closeBatch(tx, ctx, cmd, meta) }),
    [M.transferToLaying]: defineMutation({ schema: TransferToLaying, action: "flock.manage", apply: (tx, ctx, cmd, meta) => transferToLaying(tx, ctx, cmd, meta) }),
    // B6 "Reopening": the owner's (finance.manage), as it changes the books' batch results; finance's part is chained in
    // the app's registry (src/app/api/sync/registry.ts)
    [M.reopenBatch]: defineMutation({ schema: ReopenBatch, action: "finance.manage", apply: (tx, ctx, cmd, meta) => reopenBatch(tx, ctx, cmd, meta) }),
    [M.recordBatchCost]: defineMutation({ schema: RecordBatchCost, action: "flock.manage", apply: () => recordBatchCost() }),
  },
  entities: {
    batch: (ctx, data: BatchDto) => withoutMoney(ctx, data, BATCH_MONEY),
    dailyEntry: (_ctx, data: DailyEntryDto) => data, // no money in a daily entry
    weighing: (_ctx, data: WeighingDto) => data,
    soldBirds: (_ctx, data: SoldBirdsDto) => data,
    batchCost: (ctx, data: BatchCostDto) => withoutMoney(ctx, data, ["amountCentimes"]),
  },
};
