// What the phone's screens need from biosecurity, without Zod (ADR-009). The Zod schemas are in ./schema.ts, which
// re-exports this file.
export { VISIT_PURPOSES, VISITOR_RECENT_FARM_HOURS, ZONES, visitZone } from "@/modules/biosecurity/domain/visit";
export type { VisitPurpose, Zone } from "@/modules/biosecurity/domain/visit";
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

export const BIOSECURITY_MUTATIONS = { recordVisit: "biosecurity.recordVisit" } as const;
