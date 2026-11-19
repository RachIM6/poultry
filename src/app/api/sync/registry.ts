import type { SyncRegistry } from "@/lib/sync/server";

// Every offline mutation and synced entity, from the modules' index.ts. Farms and houses arrive with T10.
export const registry: SyncRegistry = { mutations: {}, entities: {} };
