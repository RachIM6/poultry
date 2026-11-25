import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC-m2-compliance BS1–BS2: the visitor and vehicle register (law 49-99, SCOPE §4).

export const VISIT_PURPOSES = ["feedDelivery", "gas", "chickDelivery", "vet", "buyer", "technician", "other"] as const;
export const ZONES = ["clean", "dirty"] as const;
export type VisitPurpose = (typeof VISIT_PURPOSES)[number];
export type Zone = (typeof ZONES)[number];

/**
 * How recent a visit to another poultry farm counts, as the screen asks it. A farm rule from the canvas, not a legal
 * one: change it here, never in a screen.
 */
export const VISITOR_RECENT_FARM_HOURS = 48;

/** BS2: a visitor who was on another poultry farm recently stays in the dirty zone. */
export const visitZone = (v: { recentFarm: boolean; zone: Zone }): Result<Zone, "VISIT_DIRTY_ZONE_ONLY"> =>
  v.recentFarm && v.zone === "clean" ? fail("VISIT_DIRTY_ZONE_ONLY") : ok(v.zone);
