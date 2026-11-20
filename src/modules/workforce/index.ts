// Public API of the `workforce` module (see CAPABILITY-MAP.md). Other modules and the app import only from here,
// or from ./schema and ./shared (ADR-008, ADR-009).
import type { SyncRegistry } from "@/lib/sync/server";
import { employeesSync } from "./sync";
import { attendanceSync } from "./attendance-sync";
import { paySync } from "./pay-sync";
import { tasksSync } from "./tasks-sync";

export const workforceSync: SyncRegistry = {
  mutations: { ...employeesSync.mutations, ...tasksSync.mutations, ...attendanceSync.mutations, ...paySync.mutations },
  entities: { ...employeesSync.entities, ...tasksSync.entities, ...attendanceSync.entities, ...paySync.entities },
};
export { advancesChangedSince, payCosts, payMonthsChangedSince, payPaymentsChangedSince, wagesDue } from "./finance-facts";
