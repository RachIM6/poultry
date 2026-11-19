// What the phone's screens need from climate, without Zod (ADR-009). The Zod schemas are in ./schema.ts.

export { checkBands, outOfRange, setOn, targetFor, verdicts } from "@/modules/climate/domain/targets";
export type { Band, BandError, Reading, TargetSet, Verdict, Verdicts } from "@/modules/climate/domain/targets";

export const CLIMATE_MUTATIONS = {
  saveTargets: "climate.saveTargets",
  recordReading: "climate.recordReading",
} as const;

/** CL2: one reading of a house. Temperature in tenths of °C, humidity in %, ammonia in ppm (null: not measured). */
export type ReadingDto = { id: string; farmId: string; houseId: string; day: string; time: string; temperatureTenths: number; humidity: number; ammonia: number | null; byUserId: string };
