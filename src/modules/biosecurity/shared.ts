// What the phone's screens need from biosecurity, without Zod (ADR-009). The Zod schemas are in ./schema.ts, which
// re-exports this file.
export { VISIT_PURPOSES, VISITOR_RECENT_FARM_HOURS, ZONES, visitZone } from "@/modules/biosecurity/domain/visit";
export type { VisitPurpose, Zone } from "@/modules/biosecurity/domain/visit";
export { DISPOSAL_METHODS, MANURE_DESTINATIONS, checkDisposal, disposalGaps } from "@/modules/biosecurity/domain/disposal";
export type { DisposalGap, DisposalMethod, ManureDestination } from "@/modules/biosecurity/domain/disposal";
export { CLEANOUT_STEPS, checkStep, downtimeDay, downtimeWarning } from "@/modules/biosecurity/domain/cleanout";
export type { CleanoutStep as CleanoutStepKey } from "@/modules/biosecurity/domain/cleanout";
import type { CleanoutStep } from "@/modules/biosecurity/domain/cleanout";
import type { DisposalMethod, ManureDestination } from "@/modules/biosecurity/domain/disposal";
import type { VisitPurpose, Zone } from "@/modules/biosecurity/domain/visit";

/** BS1: what pull returns and the phone stores. No money: every member sees it. */
export type VisitDto = {
  id: string;
  farmId: string;
  enteredAt: string; // ISO instant
  visitor: string; // name and company
  vehicle: string | null;
  purpose: VisitPurpose;
  recentFarm: boolean;
  wheelsDisinfected: boolean;
  footbath: boolean;
  farmClothing: boolean;
  zone: Zone;
};

/** BS6: dead birds disposed of on a farm day. */
export type DisposalDto = {
  id: string;
  farmId: string;
  day: string; // farm day
  batchId: string | null;
  birds: number;
  weightGrams: number | null;
  method: DisposalMethod;
  methodNote: string | null;
};

/** BS7: manure taken out. Quantity in kg (integer); no money (the sale's amount is out of scope). */
export type ManureRemovalDto = {
  id: string;
  farmId: string;
  day: string;
  houseId: string | null;
  batchId: string | null;
  quantityKg: number;
  destination: ManureDestination;
  recipient: string | null;
};

export const BIOSECURITY_MUTATIONS = {
  recordVisit: "biosecurity.recordVisit",
  recordDisposal: "biosecurity.recordDisposal",
  recordManure: "biosecurity.recordManure",
  startCleanout: "biosecurity.startCleanout",
  recordCleanoutStep: "biosecurity.recordCleanoutStep",
  setMinDowntime: "biosecurity.setMinDowntime",
  recordRodentCheck: "biosecurity.recordRodentCheck",
} as const;

/** BS4: a step of a clean-out, marked once. Disinfection says with what (product, dose, product lot). */
export type CleanoutStepDto = {
  id: string;
  step: CleanoutStep;
  day: string; // farm day
  product: string | null;
  dose: string | null;
  productLot: string | null;
  note: string | null;
};

/** BS4: the clean-out of a house after its batch `afterBatchId`, with the steps done so far. */
export type CleanoutDto = { id: string; farmId: string; houseId: string; afterBatchId: string; startedOn: string; steps: CleanoutStepDto[] };

/** BS5: the farm's own minimum downtime in days, or none (CQ3). Keyed by the farm. */
export type DowntimeSettingDto = { id: string; farmId: string; minDays: number | null };

/** BS8: what a rodent check did. */
export const RODENT_ACTIONS = ["baitPlaced", "baitChecked"] as const;

/** BS8: rodent control (law 49-99 art. 15). `proofFileId`: the photo, attached online later; null until then. */
export type RodentCheckDto = {
  id: string;
  farmId: string;
  houseId: string | null;
  day: string;
  action: (typeof RODENT_ACTIONS)[number];
  product: string | null;
  proofFileId: string | null;
};
