import type { Tx } from "@/lib/db";
import { addFarmDays, type FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { houseAreas, type LegalEntityDto } from "@/modules/farm-registry";
import { eggsLaidBetween } from "@/modules/eggs";
import { batchesForFinance } from "@/modules/flock";
import { facts } from "@/modules/finance/application/assets";
import { batchResultsIn } from "@/modules/finance/application/batch-results";
import type { AssetCategory } from "@/modules/finance/domain/assets";
import type { HensMethod } from "@/modules/finance/domain/hens";
import { suggestedEggCost, type EggCostSuggestion } from "@/modules/finance/domain/egg-cost";
import { depreciationShares } from "@/modules/finance/domain/production-cost";

// SPEC-finance FC5, FQ18 (PCA p. 42, decided default to review): a suggested cost per egg next to the owner's value per
// egg at the close. Reads flock, eggs and farm-registry through their index; writes nothing.

type FiscalYear = { from: FarmDay; to: FarmDay };

/** A farm's suggestion; `from`: the period's first day (the fiscal year's, or its first flock's placement when later). */
export type EggCostView = EggCostSuggestion & { from: FarmDay; to: FarmDay; hensPending: boolean };

/**
 * Each farm's suggested cost per egg over the fiscal year up to its last day: the production costs of its layer batches
 * placed by then and not closed before the year began (FC4's parts with the production filter, the chicks left out: the
 * hens are an asset, FC6), dated in the year, plus `hens`' classic depreciation charge of the year, ÷ the eggs they laid
 * in it. `hens`: the close's FC6 result; only the classic method depreciates the hens (none simplified, p. 89), and
 * not while a flock's life and cull value are untyped (`hensPending`). A farm with no flock or no egg in the year gets "NO_EGGS".
 */
export async function eggCostSuggestions(
  tx: Tx,
  ctx: TenantContext,
  entity: LegalEntityDto,
  year: FiscalYear,
  farmIds: readonly string[],
  hens: { method: HensMethod | null; lines: readonly { id: string; species: string; charge: bigint; missing: boolean }[] },
): Promise<Map<string, EggCostView>> {
  const layers = (await batchesForFinance(tx, ctx, year.to)).filter((b) => b.species === "layer" && (b.closedOn === null || b.closedOn >= year.from));
  const before = addFarmDays(year.from, -1);
  const [now, then, laid, assets, houses] = await Promise.all([
    layers.length > 0 ? batchResultsIn(tx, ctx, year.to, true) : [],
    // ponytail: the year's costs as (to the last day) − (to the eve of the year); a shared expense of an earlier year
    // whose split moved as batches froze could shift a few centimes between the two. A suggestion, so good enough.
    layers.some((b) => b.placedOn <= before) ? batchResultsIn(tx, ctx, before, true) : [],
    eggsLaidBetween(tx, ctx, year.from, year.to),
    layers.length > 0 ? tx.fixedAsset.findMany({ where: { organizationId: ctx.organizationId, legalEntityId: entity.id } }) : [],
    houseAreas(tx, ctx),
  ]);
  const own = (r: (typeof now)[number]) => ({ direct: r.costs.consumption + r.costs.other + r.costs.direct, indirect: r.costs.allocated });
  const nowOf = new Map(now.map((r) => [r.id, own(r)]));
  const thenOf = new Map(then.map((r) => [r.id, own(r)]));
  const placed = assets.map((a) => ({ ...facts(a), category: a.category as AssetCategory, farmId: a.farmId, houseId: a.houseId }));
  const depreciation = depreciationShares(placed, houses, layers, year, entity.fiscalYearStartMonth);
  const hensOf = new Map(hens.method === "classic" ? hens.lines.filter((h) => h.species === "layer").map((h) => [h.id, h]) : []);

  return new Map(
    farmIds.map((farmId) => {
      const flocks = layers.filter((b) => b.farmId === farmId);
      const costs = { direct: 0n, depreciation: 0n, indirect: 0n, hens: 0n };
      let eggs = 0;
      for (const b of flocks) {
        const [n, t] = [nowOf.get(b.id), thenOf.get(b.id)];
        costs.direct += (n?.direct ?? 0n) - (t?.direct ?? 0n);
        costs.indirect += (n?.indirect ?? 0n) - (t?.indirect ?? 0n);
        costs.depreciation += depreciation.get(b.id) ?? 0n;
        costs.hens += hensOf.get(b.id)?.charge ?? 0n;
        eggs += laid.get(b.id) ?? 0;
      }
      const first = flocks.reduce<string>((d, b) => (b.placedOn < d ? b.placedOn : d), year.to);
      const from = (flocks.length > 0 && first > year.from ? first : year.from) as FarmDay;
      return [farmId, { ...suggestedEggCost(costs, eggs), from, to: year.to, hensPending: flocks.some((b) => hensOf.get(b.id)?.missing) }];
    }),
  );
}
