import { addFarmDays, daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { divHalfUp } from "@/lib/kernel/money";
import { straightLine, type AssetCategory, type DepreciableAsset } from "@/modules/finance/domain/assets";
import { monthPeriod } from "@/modules/finance/domain/batch";
import { fiscalYearOf } from "@/modules/finance/domain/entry";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/modules/finance/domain/treasury";

// SPEC-finance FC4, FQ19 (PCA 2015 pp. 42–43, decided default to review): the production cost of a batch in progress
// at the close is its direct costs, the depreciation of the buildings and equipment it used and the indirect production
// costs, never « les frais d'administration générale », storage, research, financial charges or distribution costs.

/**
 * FQ19: which quick-expense categories are production costs. Catching (the crew or the transport of the birds sold) is a
 * distribution cost, bank fees administration (p. 43); every other category serves the animals or the houses.
 */
export const PRODUCTION_EXPENSES: Record<ExpenseCategory, boolean> = { electricity: true, water: true, vet_fees: true, insurance: true, catching: false, bank_fees: false };
export const PRODUCTION_EXPENSE_CATEGORIES = EXPENSE_CATEGORIES.filter((c) => PRODUCTION_EXPENSES[c]);

/**
 * FQ19: « L'amortissement des bâtiments et matériels d'élevage » (p. 42): the houses, installations and equipment. Land
 * is not depreciated; transport, office and computer equipment serve distribution or administration.
 */
export const PRODUCTION_ASSETS: Record<AssetCategory, boolean> = {
  land: false,
  prepared_land: false,
  building: true,
  building_on_other_land: true,
  installation: true,
  installation_on_other_land: true,
  equipment: true,
  transport: false,
  office_furniture: false,
  office_equipment: false,
  computer: false,
  other_furniture: false,
};

type PlacedAsset = DepreciableAsset & { category: AssetCategory; farmId: string | null; houseId: string | null };
type HouseIn = { id: string; farmId: string; areaM2: number };
/** `until`: the batch's last day counted, when before the year's last depreciated day (a transfer to lay, FC6). */
type BatchIn = { id: string; houseId: string; placedOn: string; until?: string };

const monthOf = (day: string) => day.slice(0, 7);
const plusMonths = (month: string, n: number) => {
  const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};

/**
 * §7 `depreciationShare` (FQ19): each batch open at the close takes a share of the fiscal year's charge (FC1) of every
 * production asset of its house or farm: charge × its house's m² × its days in the months depreciated that year (up to
 * the close) ÷ (the m² of the houses the asset serves × those months' days), half up per asset. An asset on a house
 * serves that house; on a farm only, all the farm's houses; on neither, no batch. A share for empty days or other
 * batches stays in the year's charges (§7.1 F).
 */
export function depreciationShares(assets: readonly PlacedAsset[], houses: readonly HouseIn[], batches: readonly BatchIn[], year: { from: FarmDay; to: FarmDay }, fiscalYearStartMonth: number): Map<string, bigint> {
  const shares = new Map<string, bigint>();
  for (const a of assets) {
    if (!PRODUCTION_ASSETS[a.category] || (!a.houseId && !a.farmId)) continue;
    const row = straightLine(a, fiscalYearStartMonth).find((y) => y.from === year.from);
    if (!row || row.charge <= 0n) continue;
    // The months depreciated this year are contiguous: from the year's first month or the asset's first, `months` long.
    const started = monthOf(a.opening && a.opening.on > a.inServiceOn ? a.opening.on : a.inServiceOn);
    const first = started > monthOf(year.from) ? started : monthOf(year.from);
    const from = monthPeriod(first).from as FarmDay;
    const to = monthPeriod(plusMonths(first, row.months - 1)).to as FarmDay;
    const served = houses.filter((h) => (a.houseId ? h.id === a.houseId : h.farmId === a.farmId));
    const capacity = BigInt(served.reduce((s, h) => s + h.areaM2, 0)) * BigInt(daysBetween(from, to) + 1);
    if (capacity === 0n) continue;
    for (const b of batches) {
      const house = served.find((h) => h.id === b.houseId);
      const start = (b.placedOn > from ? b.placedOn : from) as FarmDay;
      const end = (b.until && b.until < to ? b.until : to) as FarmDay;
      if (!house || start > end) continue;
      const weight = BigInt(house.areaM2) * BigInt(daysBetween(start, end) + 1);
      shares.set(b.id, (shares.get(b.id) ?? 0n) + divHalfUp(row.charge * weight, capacity));
    }
  }
  return shares;
}

/**
 * FC6 classic (FQ19, PCA p. 34): a pullet batch's share of the production assets' depreciation from its placement to
 * `until` (a year end, or its transfer to lay), summed over the fiscal years it spans: each year's `depreciationShares`
 * at that year's daily rate, the last one counted up to `until`. Cumulative, so the close capitalises a year's part as
 * this to its last day less this to the previous year end, and the transfer the rest (§7.1 G).
 */
export function depreciationToDay(assets: readonly PlacedAsset[], houses: readonly HouseIn[], batch: Omit<BatchIn, "until">, until: FarmDay, fiscalYearStartMonth: number): bigint {
  let total = 0n;
  for (let y = fiscalYearOf(batch.placedOn as FarmDay, fiscalYearStartMonth); y.from <= until; y = fiscalYearOf(addFarmDays(y.to, 1), fiscalYearStartMonth)) {
    total += depreciationShares(assets, houses, [{ ...batch, until }], y, fiscalYearStartMonth).get(batch.id) ?? 0n;
  }
  return total;
}
