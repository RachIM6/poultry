// What the phone's screens need from planning, without Zod (ADR-009). The Zod schemas are in ./schema.ts.
export { OFFICIAL_DOWNTIME, batchDowntime, checkDowntimeRule, downtimeByHouse, downtimeOn, houseCycles, houseTimeline, placementDowntime, saleDay } from "@/modules/planning/domain/plan";
export type { DowntimeRule, DowntimeWarning, HouseCycle, HouseLine, PlanDto, Slot } from "@/modules/planning/domain/plan";

export const PLANNING_MUTATIONS = {
  savePlan: "planning.savePlan",
  cancelPlan: "planning.cancelPlan",
  saveDowntime: "planning.saveDowntime",
  placeFromPlan: "planning.placeFromPlan",
} as const;
