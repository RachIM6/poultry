import { z } from "zod";

// SPEC-m4 §5, the sync push's validation. The phone's screens import ./shared.ts (no Zod, ADR-009).
export * from "@/modules/climate/shared";

const bound = (min: number, max: number) => z.int32().min(min).max(max).nullable();

// CL1: input bounds only (typos), not targets. Temperatures in tenths of °C.
export const BandInput = z.object({
  fromAge: z.int32().min(0).max(800),
  toAge: z.int32().min(0).max(800),
  temperatureMinTenths: bound(-100, 600),
  temperatureMaxTenths: bound(-100, 600),
  humidityMin: bound(0, 100),
  humidityMax: bound(0, 100),
  ammoniaMax: bound(0, 500),
});

/** A new version of the farm's targets: never edited in place, so past readings keep their verdict. */
export const SaveTargets = z.object({ id: z.uuid(), validFrom: z.iso.date(), source: z.string().trim().min(3).max(300), bands: z.array(BandInput).min(1).max(30) });

// CL2: input bounds only (typos), not targets.
export const RecordReading = z.object({
  id: z.uuid(),
  houseId: z.uuid(),
  day: z.iso.date(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), // farm clock
  temperatureTenths: z.int32().min(-100).max(600),
  humidity: z.int32().min(0).max(100),
  ammonia: z.int32().min(0).max(500).nullable(),
});
