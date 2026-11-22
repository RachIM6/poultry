import type { Line } from "@/modules/finance/domain/entry";
import { samePosting } from "@/modules/finance/domain/posting";

// SPEC-finance FCX4: the close run. One OD entry per kind, on the fiscal year's last day.

/** The run's kinds, in posting order. T106 adds the subsidy release, T108 stocks, T109 batches in progress. */
export const CLOSE_KINDS = ["depreciation"] as const;
export type CloseKind = (typeof CLOSE_KINDS)[number];

/** FCX4: the entry's source id, `close:<kind>:<legal entity>:<year>` (the calendar year the fiscal year ends in). */
export const closeSource = (kind: CloseKind, legalEntityId: string, year: number) => `close:${kind}:${legalEntityId}:${year}`;

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
