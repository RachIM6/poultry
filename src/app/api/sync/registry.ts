import type { SyncRegistry } from "@/lib/sync/server";
import { farmRegistrySync } from "@/modules/farm-registry";
import { financeSync } from "@/modules/finance";
import { climateSync } from "@/modules/climate";
import { flockSync } from "@/modules/flock";
import { healthSync } from "@/modules/health";
import { inventorySync } from "@/modules/inventory";
import { notificationsSync } from "@/modules/notifications";
import { referenceDataSync } from "@/modules/reference-data";
import { salesSync } from "@/modules/sales";
import { workforceSync } from "@/modules/workforce";

// Every offline mutation and synced entity, from the modules' index.ts.
const modules: SyncRegistry[] = [farmRegistrySync, referenceDataSync, notificationsSync, inventorySync, flockSync, healthSync, salesSync, financeSync, workforceSync, climateSync];

export const registry: SyncRegistry = {
  mutations: Object.assign({}, ...modules.map((m) => m.mutations)),
  entities: Object.assign({}, ...modules.map((m) => m.entities)),
  // SPEC-m5 PA4, PA5 (ADR-011): what a partner's phone receives; anything else, a new entity included, never leaves.
  views: {
    vet: ["farm", "house", "batch", "dailyEntry", "weighing", "soldBirds", "protocol", "vaccination", "treatment", "vetVisit", "stockItem", "movement", "notification"],
    accountant: [
      "farm", "house", "batch", "soldBirds", "batchCost", "supplier", "stockItem", "movement", "purchase", "buyer", "sale", "buyerPayment", "instrumentStatus",
      "treasuryAccount", "expense", "transfer", "employee", "advance", "payMonth", "labourRules", "notification",
    ],
  },
};
