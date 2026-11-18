import { z } from "zod";

// SPEC-m5 §7, the sync push's validation. The phone's screens import ./shared.ts (no Zod, ADR-009).
export * from "@/modules/planning/shared";

// PL1: created or edited while planned. Integer centimes for the booked chick price, when known.
export const SavePlan = z.object({
  id: z.uuid(),
  houseId: z.uuid(),
  placeOn: z.iso.date(),
  chicks: z.int32().positive(),
  strainId: z.string().trim().min(1).max(60),
  hatchery: z.string().trim().min(1).max(120),
  chickPriceCentimes: z.string().regex(/^\d{1,12}$/).nullable(),
  saleAge: z.int32().min(1).max(800).nullable(),
});
export const CancelPlan = z.object({ id: z.uuid() });

// PL5, §2: the owner's minimum downtime with its source; a new dated version each time.
export const SaveDowntime = z.object({ id: z.uuid(), farmId: z.uuid(), validFrom: z.iso.date(), minDays: z.int32().min(0).max(365), source: z.string().trim().min(3).max(300) });
