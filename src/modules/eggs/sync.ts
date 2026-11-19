import { defineMutation, type SyncRegistry } from "@/lib/sync/server";
import { correctCollection, recordCollection } from "@/modules/eggs/application/collections";
import { CorrectCollection, EGG_MUTATIONS as M, RecordCollection, type EggCollectionDto } from "@/modules/eggs/schema";

// Offline egg writes (SPEC-m3 E1): collecting eggs is the worker's job, like the daily entry.
export const eggsSync: SyncRegistry = {
  mutations: {
    [M.recordCollection]: defineMutation({ schema: RecordCollection, action: "eggs.record", apply: (tx, ctx, cmd, meta) => recordCollection(tx, ctx, cmd, meta) }),
    [M.correctCollection]: defineMutation({ schema: CorrectCollection, action: "eggs.record", apply: (tx, ctx, cmd, meta) => correctCollection(tx, ctx, cmd, meta) }),
  },
  entities: {
    eggCollection: (_ctx, data: EggCollectionDto) => data, // no money in a collection
  },
};
