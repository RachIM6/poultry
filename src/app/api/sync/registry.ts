import type { SyncRegistry } from "@/lib/sync/server";
import { biosecuritySync } from "@/modules/biosecurity";
import { documentsSync } from "@/modules/documents";
import { farmRegistrySync } from "@/modules/farm-registry";
import { financeSync } from "@/modules/finance";
import { flockSync } from "@/modules/flock";
import { healthSync } from "@/modules/health";
import { inventorySync } from "@/modules/inventory";
import { notificationsSync } from "@/modules/notifications";
import { referenceDataSync } from "@/modules/reference-data";
import { salesSync } from "@/modules/sales";

// Every offline mutation and synced entity, from the modules' index.ts.
const modules: SyncRegistry[] = [farmRegistrySync, referenceDataSync, notificationsSync, inventorySync, flockSync, healthSync, salesSync, financeSync, biosecuritySync, documentsSync];

export const registry: SyncRegistry = {
  mutations: Object.assign({}, ...modules.map((m) => m.mutations)),
  entities: Object.assign({}, ...modules.map((m) => m.entities)),
};
