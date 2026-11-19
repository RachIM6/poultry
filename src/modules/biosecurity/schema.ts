import { z } from "zod";
import { VISIT_PURPOSES, ZONES } from "@/modules/biosecurity/shared";

export * from "@/modules/biosecurity/shared";

// Offline writes (SPEC-m2-compliance BS1): the same schemas validate on the phone and in the sync push.
export const RecordVisit = z.object({
  id: z.uuid(),
  farmId: z.uuid(),
  enteredAt: z.iso.datetime({ offset: true }),
  visitor: z.string().trim().min(1).max(120),
  vehicle: z.string().trim().min(1).max(20).nullable(),
  purpose: z.enum(VISIT_PURPOSES),
  recentFarm: z.boolean(),
  wheelsDisinfected: z.boolean(),
  footbath: z.boolean(),
  farmClothing: z.boolean(),
  zone: z.enum(ZONES),
});
export type RecordVisit = z.infer<typeof RecordVisit>;
