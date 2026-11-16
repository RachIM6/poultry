// What the phone's screens need from biosecurity, without Zod (ADR-009). The Zod schemas are in ./schema.ts, which
// re-exports this file.
export { VISIT_PURPOSES, VISITOR_RECENT_FARM_HOURS, ZONES, visitZone } from "@/modules/biosecurity/domain/visit";
export type { VisitPurpose, Zone } from "@/modules/biosecurity/domain/visit";
export { DISPOSAL_METHODS, MANURE_DESTINATIONS, checkDisposal, disposalGaps } from "@/modules/biosecurity/domain/disposal";
export type { DisposalGap, DisposalMethod, ManureDestination } from "@/modules/biosecurity/domain/disposal";
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
} as const;
