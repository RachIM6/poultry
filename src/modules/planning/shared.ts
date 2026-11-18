// What the phone's screens need from planning, without Zod (ADR-009). The Zod schemas are in ./schema.ts.
export { downtimeOn, houseTimeline, saleDay } from "@/modules/planning/domain/plan";
export type { DowntimeRule, HouseLine, PlanDto, Slot } from "@/modules/planning/domain/plan";

export const PLANNING_MUTATIONS = {
  savePlan: "planning.savePlan",
  cancelPlan: "planning.cancelPlan",
  saveDowntime: "planning.saveDowntime",
  placeFromPlan: "planning.placeFromPlan",
} as const;
