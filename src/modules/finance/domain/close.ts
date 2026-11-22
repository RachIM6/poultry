import type { Line } from "@/modules/finance/domain/entry";
import { samePosting } from "@/modules/finance/domain/posting";

// SPEC-finance FCX4: the close run. One OD entry per kind, on the fiscal year's last day.

/** The run's kinds, in posting order: depreciation, the subsidy release (T106); T108 adds stocks, T109 batches in progress. */
export const CLOSE_KINDS = ["depreciation", "subsidy"] as const;
export type CloseKind = (typeof CLOSE_KINDS)[number];

/** FCX4: the entry's source id, `close:<kind>:<legal entity>:<year>` (the calendar year the fiscal year ends in). */
export const closeSource = (kind: CloseKind, legalEntityId: string, year: number) => `close:${kind}:${legalEntityId}:${year}`;

/**
 * FCX5: the kinds whose close entry is reversed on the next fiscal year's first day, with its à-nouveaux. T108 (stocks)
 * and T109 (batches in progress) set theirs, provisions included. Depreciation and the subsidy release are never reversed.
 */
export const REVERSED_AT_OPENING: Record<CloseKind, boolean> = { depreciation: false, subsidy: false };

/** FN3, FCX6: the à-nouveaux's source id, by the first day of the fiscal year it opens (FN7 versions). */
export const openingSource = (legalEntityId: string, firstDay: string) => `opening:${legalEntityId}:${firstDay}`;

/** FCX5: the source id of a close entry's reversal at the next opening. */
export const reversalSource = (kind: CloseKind, legalEntityId: string, year: number) => `reversal:${closeSource(kind, legalEntityId, year)}`;

/**
 * FN7 for a kind: nothing to post; the same figures as the standing version (nothing posted); a first version; a
 * reversal of the standing version and a new one; or, the figures now zero, the reversal alone.
 */
export type CloseAction = "none" | "unchanged" | "post" | "repost" | "reverse";

type Figures = { day: string; lines: readonly Line[] };
export function closeAction(standing: Figures | null, computed: Figures | null): CloseAction {
  if (!standing) return computed ? "post" : "none";
  if (!computed) return "reverse";
  return samePosting(standing, computed) ? "unchanged" : "repost";
}
