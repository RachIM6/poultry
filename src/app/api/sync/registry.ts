import type { SyncRegistry } from "@/lib/sync/server";
import { eggsSync } from "@/modules/eggs";
import { biosecuritySync } from "@/modules/biosecurity";
import { documentsSync } from "@/modules/documents";
import { farmRegistrySync } from "@/modules/farm-registry";
import { financeSync } from "@/modules/finance";
import { climateSync } from "@/modules/climate";
import { flockSync } from "@/modules/flock";
import { healthSync } from "@/modules/health";
import { inventorySync } from "@/modules/inventory";
import { marketPricesSync } from "@/modules/market-prices";
import { notificationsSync } from "@/modules/notifications";
import { planningSync } from "@/modules/planning";
import { referenceDataSync } from "@/modules/reference-data";
import { salesSync } from "@/modules/sales";
import { workforceSync } from "@/modules/workforce";

// Every offline mutation and synced entity, from the modules' index.ts.
const modules: SyncRegistry[] = [farmRegistrySync, referenceDataSync, notificationsSync, inventorySync, flockSync, eggsSync, healthSync, salesSync, financeSync, workforceSync, climateSync, marketPricesSync, planningSync, biosecuritySync, documentsSync];

export const registry: SyncRegistry = {
  mutations: Object.assign({}, ...modules.map((m) => m.mutations)),
  entities: Object.assign({}, ...modules.map((m) => m.entities)),
  // SPEC-m5 PA4, PA5 (ADR-013): what a partner's phone receives; anything else, a new entity included, never leaves.
  views: {
    vet: ["farm", "house", "batch", "dailyEntry", "weighing", "soldBirds", "protocol", "vaccination", "treatment", "vetVisit", "stockItem", "movement", "notification"],
    accountant: [
      "farm", "house", "batch", "soldBirds", "batchCost", "supplier", "stockItem", "movement", "purchase", "supplierPayment", "buyer", "sale", "buyerPayment", "instrumentStatus",
      "treasuryAccount", "expense", "transfer", "employee", "advance", "payMonth", "payPayment", "labourRules", "price", "notification",
    ],
  },
};
