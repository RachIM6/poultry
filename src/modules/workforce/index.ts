// Public API of the `workforce` module (see CAPABILITY-MAP.md). Other modules and the app import only from here,
// or from ./schema and ./shared (ADR-008, ADR-009).
import type { SyncRegistry } from "@/lib/sync/server";
import { employeesSync } from "./sync";
import { tasksSync } from "./tasks-sync";

export const workforceSync: SyncRegistry = {
  mutations: { ...employeesSync.mutations, ...tasksSync.mutations },
  entities: { ...employeesSync.entities, ...tasksSync.entities },
};
