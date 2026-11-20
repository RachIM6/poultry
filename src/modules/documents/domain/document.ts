import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";

// SPEC-m2-compliance DC1, DC3: the vault's documents and when they need renewing.

export const DOCUMENT_CATEGORIES = ["authorization", "vetContract", "labReport", "insurance", "land", "company", "tax", "equipment", "other"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** How early a renewal shows as "soon" and is announced (DC4). A choice from the canvas, not a legal delay. */
export const DOCUMENT_SOON_DAYS = 60;

export type DocumentState = "expired" | "soon" | "valid" | "none";

/** A document is valid through its expiry day. */
export function documentState(expiresOn: string | null, today: FarmDay): DocumentState {
  if (expiresOn === null) return "none";
  const left = daysBetween(today, expiresOn as FarmDay);
  return left < 0 ? "expired" : left <= DOCUMENT_SOON_DAYS ? "soon" : "valid";
}

export const byExpiry = (x: { expiresOn: string | null }, y: { expiresOn: string | null }) =>
  x.expiresOn === y.expiresOn ? 0 : x.expiresOn === null ? 1 : y.expiresOn === null ? -1 : x.expiresOn.localeCompare(y.expiresOn);
