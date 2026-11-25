import { divHalfUp } from "@/lib/kernel/money";

// SPEC-finance FC5, FQ18 (PCA 2015 p. 42, decided default to review): the maintenance costs of the hens « relatifs à la
// période de ponte » go « dans le prix de revient des oeufs pondus ». A suggestion only: the run posts the value per egg
// the owner types (§7.1 G).

/**
 * A farm's laying flocks' production costs over the period, in centimes: FC4's parts (direct, the depreciation share of
 * the production assets, the indirect production costs) and the hens' own depreciation (FC6 classic; none simplified).
 */
export type LayingCosts = { direct: bigint; depreciation: bigint; indirect: bigint; hens: bigint };

/** `perEgg` null: no suggestion, `reason` says why (no egg laid in the period, or no cost recorded). */
export type EggCostSuggestion = LayingCosts & { total: bigint; eggs: number; perEgg: bigint | null; reason: "NO_EGGS" | "NO_COSTS" | null };

/** §7 `suggestedEggCost`: the period's laying costs ÷ the eggs laid in it, half up to the centime; never a cost from nothing. */
export function suggestedEggCost(costs: LayingCosts, eggs: number): EggCostSuggestion {
  const total = costs.direct + costs.depreciation + costs.indirect + costs.hens;
  const reason = eggs <= 0 ? "NO_EGGS" : total <= 0n ? "NO_COSTS" : null;
  return { ...costs, total, eggs, perEgg: reason ? null : divHalfUp(total, BigInt(eggs)), reason };
}
