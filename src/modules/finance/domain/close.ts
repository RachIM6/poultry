import { reversalOf, type Line } from "@/modules/finance/domain/entry";
import { samePosting } from "@/modules/finance/domain/posting";
import { PROVISION_CHARGE, PROVISION_REVERSAL } from "@/modules/finance/domain/stocks";

// SPEC-finance FCX4: the close run. One OD entry per kind, on the fiscal year's last day.

/**
 * The run's kinds, in posting order: depreciation, the subsidy release (T106), bought stock (T108), the meat batches
 * in progress (T109, FC4), the laying hens and their pullets (T114, T115, FC6: their own entry, with their charge,
 * culls and provision), the provisions for impairment of current assets (FC4, FC5: one entry for every provision,
 * FCX4) and the loans' accrued interest (FQ16).
 */
export const CLOSE_KINDS = ["depreciation", "subsidy", "stock", "batch", "hens", "provision", "interest"] as const;
export type CloseKind = (typeof CLOSE_KINDS)[number];

/** FCX4: the entry's source id, `close:<kind>:<legal entity>:<year>` (the calendar year the fiscal year ends in). */
export const closeSource = (kind: CloseKind, legalEntityId: string, year: number) => `close:${kind}:${legalEntityId}:${year}`;

/**
 * FCX5: the kinds whose close entry is reversed on the next fiscal year's first day, with its à-nouveaux: the accrued
 * interest (FQ16: the installment then books its whole interest), stocks, batches in progress and provisions (T108,
 * T109). Depreciation and the subsidy release are never reversed, nor the hens (FC6): 23962 builds up until the
 * transfer to lay, and the simplified method reverses the previous year's value in the next close run (p. 131).
 */
export const REVERSED_AT_OPENING: Record<CloseKind, boolean> = { depreciation: false, subsidy: false, stock: true, batch: true, hens: false, provision: true, interest: true };

/**
 * FCX5: a close entry's reversal at the next opening, sides swapped; a provision is taken back as a reversal of
 * provisions (FC4, FC5: D 3912 / C 7196), not as a credit to the charge.
 */
export const openingReversalOf = (lines: readonly Line[]): Line[] => reversalOf(lines).map((l) => (l.account === PROVISION_CHARGE ? { ...l, account: PROVISION_REVERSAL } : l));

/** FN3, FCX6: the à-nouveaux's source id, by the first day of the fiscal year it opens (FN7 versions). */
export const OPENING_PREFIX = "opening:";
export const openingSource = (legalEntityId: string, firstDay: string) => `${OPENING_PREFIX}${legalEntityId}:${firstDay}`;

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
