import type { SyncRegistry } from "@/lib/sync/server";
import { farmRegistrySync } from "@/modules/farm-registry";
import { referenceDataSync } from "@/modules/reference-data";

// Every offline mutation and synced entity, from the modules' index.ts.
const modules: SyncRegistry[] = [farmRegistrySync, referenceDataSync];

export const registry: SyncRegistry = {
  mutations: Object.assign({}, ...modules.map((m) => m.mutations)),
  entities: Object.assign({}, ...modules.map((m) => m.entities)),
};
