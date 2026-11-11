import { defineMutation, type SyncRegistry } from "@/lib/sync/server";
import { planBatchVaccinations } from "@/modules/health/application/plan-vaccinations";
import { recordVaccination } from "@/modules/health/application/record-vaccination";
import { HEALTH_MUTATIONS as M, PlanVaccinations, RecordVaccination, type VaccinationDto } from "@/modules/health/schema";

// Offline health writes. Whoever places batches plans their vaccinations; every member records them (SPEC I5).
export const healthSync: SyncRegistry = {
  mutations: {
    [M.planVaccinations]: defineMutation({ schema: PlanVaccinations, action: "health.manage", apply: (tx, ctx, cmd, meta) => planBatchVaccinations(tx, ctx, cmd, meta) }),
    [M.recordVaccination]: defineMutation({ schema: RecordVaccination, action: "health.record", apply: (tx, ctx, cmd, meta) => recordVaccination(tx, ctx, cmd, meta) }),
  },
  entities: { vaccination: (_ctx, data: VaccinationDto) => data }, // no money in a vaccination
};
