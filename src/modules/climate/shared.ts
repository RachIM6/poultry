// What the phone's screens need from climate, without Zod (ADR-009). The Zod schemas are in ./schema.ts.

export { checkBands, outOfRange, setOn, targetFor, verdicts } from "@/modules/climate/domain/targets";
export type { Band, BandError, Reading, TargetSet, Verdict, Verdicts } from "@/modules/climate/domain/targets";

export const CLIMATE_MUTATIONS = {
  saveTargets: "climate.saveTargets",
} as const;
