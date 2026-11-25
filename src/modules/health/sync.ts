import { defineMutation, type SyncRegistry } from "@/lib/sync/server";
import { addVaccination, cancelVaccination, moveVaccination } from "@/modules/health/application/edit-plan";
import { planBatchVaccinations } from "@/modules/health/application/plan-vaccinations";
import { recordVaccination } from "@/modules/health/application/record-vaccination";
import { recordTreatment, recordVetVisit } from "@/modules/health/application/treatments";
import {
  AddVaccination,
  CancelVaccination,
  HEALTH_MUTATIONS as M,
  MoveVaccination,
  PlanVaccinations,
  RecordTreatment,
  RecordVaccination,
  RecordVetVisit,
  type TreatmentDto,
  type VaccinationDto,
  type VetVisitDto,
} from "@/modules/health/schema";

// Offline health writes. Whoever places batches plans their vaccinations, and they or the vet edit the plan (SPEC-m5 PA4);
// every member records what was given and the vet's visits (SPEC I5): a treatment only ever adds a withdrawal, so
// letting a worker record one is never a risk.
export const healthSync: SyncRegistry = {
  mutations: {
    [M.planVaccinations]: defineMutation({ schema: PlanVaccinations, action: "health.manage", apply: (tx, ctx, cmd, meta) => planBatchVaccinations(tx, ctx, cmd, meta) }),
    [M.addVaccination]: defineMutation({ schema: AddVaccination, action: "health.manage", apply: (tx, ctx, cmd, meta) => addVaccination(tx, ctx, cmd, meta) }),
    [M.moveVaccination]: defineMutation({ schema: MoveVaccination, action: "health.manage", apply: (tx, ctx, cmd, meta) => moveVaccination(tx, ctx, cmd, meta) }),
    [M.cancelVaccination]: defineMutation({ schema: CancelVaccination, action: "health.manage", apply: (tx, ctx, cmd, meta) => cancelVaccination(tx, ctx, cmd, meta) }),
    [M.recordVaccination]: defineMutation({ schema: RecordVaccination, action: "health.record", apply: (tx, ctx, cmd, meta) => recordVaccination(tx, ctx, cmd, meta) }),
    [M.recordTreatment]: defineMutation({ schema: RecordTreatment, action: "health.record", apply: (tx, ctx, cmd, meta) => recordTreatment(tx, ctx, cmd, meta) }),
    [M.recordVetVisit]: defineMutation({ schema: RecordVetVisit, action: "health.record", apply: (tx, ctx, cmd, meta) => recordVetVisit(tx, ctx, cmd, meta) }),
  },
  // no money in any of them
  entities: {
    vaccination: (_ctx, data: VaccinationDto) => data,
    treatment: (_ctx, data: TreatmentDto) => data,
    vetVisit: (_ctx, data: VetVisitDto) => data,
  },
};
