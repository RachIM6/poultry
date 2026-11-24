import type { z } from "zod";
import { defineMutation, type MutationHandler, type SyncRegistry } from "@/lib/sync/server";
import { PULL_VIEWS } from "@/lib/sync/views";
import { eggsSync } from "@/modules/eggs";
import { biosecuritySync } from "@/modules/biosecurity";
import { documentsSync } from "@/modules/documents";
import { farmRegistrySync } from "@/modules/farm-registry";
import { financeSync } from "@/modules/finance";
import { climateSync } from "@/modules/climate";
import { flockSync } from "@/modules/flock";
import { FLOCK_MUTATIONS, type CorrectPlacement } from "@/modules/flock/schema";
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
// health (CAPABILITY-MAP.md), so the two are chained here.
const correct = flockSync.mutations[FLOCK_MUTATIONS.correctPlacement] as unknown as MutationHandler<z.infer<typeof CorrectPlacement>>;
const correctPlacement = defineMutation({
  ...correct,
  async apply(tx, ctx, cmd, meta) {
    const corrected = await correct.apply(tx, ctx, cmd, meta);
    return corrected.ok && cmd.changes.placedOn !== undefined ? moveWithPlacement(tx, ctx, cmd.batchId, meta) : corrected;
  },
});

export const registry: SyncRegistry = {
  mutations: { ...Object.assign({}, ...modules.map((m) => m.mutations)), [FLOCK_MUTATIONS.correctPlacement]: correctPlacement },
  entities: Object.assign({}, ...modules.map((m) => m.entities)),
  views: PULL_VIEWS, // SPEC-m5 PA4, PA5 (ADR-013)
};
