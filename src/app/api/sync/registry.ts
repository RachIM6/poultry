import type { z } from "zod";
import { defineMutation, Rejection, type MutationHandler, type SyncRegistry } from "@/lib/sync/server";
import { PULL_VIEWS } from "@/lib/sync/views";
import { eggsSync } from "@/modules/eggs";
import { biosecuritySync } from "@/modules/biosecurity";
import { documentsSync } from "@/modules/documents";
import { farmRegistrySync } from "@/modules/farm-registry";
import { financeSync, reopenBatchBooks } from "@/modules/finance";
import { climateSync } from "@/modules/climate";
import { flockSync } from "@/modules/flock";
import { FLOCK_MUTATIONS, type CorrectPlacement, type ReopenBatch } from "@/modules/flock/schema";
import { healthSync, moveWithPlacement } from "@/modules/health";
import { inventorySync } from "@/modules/inventory";
import { marketPricesSync } from "@/modules/market-prices";
import { notificationsSync } from "@/modules/notifications";
import { planningSync } from "@/modules/planning";
import { referenceDataSync } from "@/modules/reference-data";
import { salesSync } from "@/modules/sales";
import { workforceSync } from "@/modules/workforce";

// Every offline mutation and synced entity, from the modules' index.ts.
const modules: SyncRegistry[] = [farmRegistrySync, referenceDataSync, notificationsSync, inventorySync, flockSync, eggsSync, healthSync, salesSync, financeSync, workforceSync, climateSync, marketPricesSync, planningSync, biosecuritySync, documentsSync];

// SPEC B1: a corrected placement day moves the batch's vaccination plan, in the same transaction. Flock may not call
// health (CAPABILITY-MAP.md), so the two are chained here. Health refuses a day after its first record once flock has
// written: thrown, so the whole correction rolls back and is recorded as rejected.
const correct = flockSync.mutations[FLOCK_MUTATIONS.correctPlacement] as unknown as MutationHandler<z.infer<typeof CorrectPlacement>>;
const correctPlacement = defineMutation({
  ...correct,
  async apply(tx, ctx, cmd, meta) {
    const corrected = await correct.apply(tx, ctx, cmd, meta);
    if (!corrected.ok || cmd.changes.placedOn === undefined) return corrected;
    const moved = await moveWithPlacement(tx, ctx, cmd.batchId, meta);
    if (!moved.ok) throw new Rejection(moved.error);
    return moved;
  },
});

// SPEC B6 "Reopening": finance refuses a closing in a locked month or a closed year and releases the frozen shares,
// then flock reopens the batch, in one transaction. Flock may not call finance, so the two are chained here; a refusal
// of flock's after finance has written is thrown, so nothing of it is kept.
const reopen = flockSync.mutations[FLOCK_MUTATIONS.reopenBatch] as unknown as MutationHandler<z.infer<typeof ReopenBatch>>;
const reopenBatch = defineMutation({
  ...reopen,
  async apply(tx, ctx, cmd, meta) {
    const books = await reopenBatchBooks(tx, ctx, cmd.batchId, meta);
    if (!books.ok) return books;
    const reopened = await reopen.apply(tx, ctx, cmd, meta);
    if (!reopened.ok) throw new Rejection(reopened.error);
    return reopened;
  },
});

export const registry: SyncRegistry = {
  mutations: { ...Object.assign({}, ...modules.map((m) => m.mutations)), [FLOCK_MUTATIONS.correctPlacement]: correctPlacement, [FLOCK_MUTATIONS.reopenBatch]: reopenBatch },
  entities: Object.assign({}, ...modules.map((m) => m.entities)),
  views: PULL_VIEWS, // SPEC-m5 PA4, PA5 (ADR-013)
};
