import { defineMutation, type SyncRegistry } from "@/lib/sync/server";
import { correctCollection, discardEggs, gradeEggs, recordCollection } from "@/modules/eggs/application/collections";
import {
  CorrectCollection,
  DiscardEggs,
  EGG_MUTATIONS as M,
  GradeEggs,
  RecordCollection,
  type EggCollectionDto,
  type EggDiscardDto,
  type EggDrawDto,
  type EggGradingDto,
} from "@/modules/eggs/schema";

// Offline egg writes (SPEC-m3 E1): collecting eggs is the worker's job, like the daily entry.
export const eggsSync: SyncRegistry = {
  mutations: {
    [M.recordCollection]: defineMutation({ schema: RecordCollection, action: "eggs.record", apply: (tx, ctx, cmd, meta) => recordCollection(tx, ctx, cmd, meta) }),
    [M.correctCollection]: defineMutation({ schema: CorrectCollection, action: "eggs.record", apply: (tx, ctx, cmd, meta) => correctCollection(tx, ctx, cmd, meta) }),
    [M.gradeEggs]: defineMutation({ schema: GradeEggs, action: "eggs.record", apply: (tx, ctx, cmd, meta) => gradeEggs(tx, ctx, cmd, meta) }),
    [M.discardEggs]: defineMutation({ schema: DiscardEggs, action: "eggs.record", apply: (tx, ctx, cmd, meta) => discardEggs(tx, ctx, cmd, meta) }),
  },
  entities: {
    eggCollection: (_ctx, data: EggCollectionDto) => data, // no money in egg records
    eggGrading: (_ctx, data: EggGradingDto) => data,
    eggDiscard: (_ctx, data: EggDiscardDto) => data,
    eggDraw: (_ctx, data: EggDrawDto) => data,
  },
};
