import { addFarmDays, type FarmDay } from "@/lib/kernel/farm-day";
import { divHalfUp } from "@/lib/kernel/money";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { ASSET_ACCOUNTS, straightLine, type AssetCategory, type DepreciableAsset } from "@/modules/finance/domain/assets";
import { fiscalYearOf } from "@/modules/finance/domain/entry";
import type { Posting } from "@/modules/finance/domain/posting";

// SPEC-finance FC2 (T106), pure: an investment subsidy, its receipt and its release, at the depreciation rate of its
// depreciable assets and over the inalienable years of its land (FQ17).

export const SUBSIDIES_RECEIVED = "1311"; // Subventions d'investissement reçues
export const SUBSIDIES_RELEASED = "1319"; // Subventions d'investissement inscrites au compte de produits et charges
export const SUBSIDY_RELEASE = "7577"; // Reprises sur subventions d'investissement de l'exercice
const BANK = "5141";
/** FQ17, PCA p. 75: without an inalienability clause in the contract, land's share is released a tenth a year. */
export const LAND_RELEASE_YEARS = 10;

/**
 * What the release needs: the amount, the day received, the register's assets it finances and, for its land, the
 * years the contract makes the land inalienable (null: no clause, `LAND_RELEASE_YEARS`).
 */
export type Subsidy = { amount: bigint; receivedOn: FarmDay; inalienableYears: number | null; assets: readonly (DepreciableAsset & { category: AssetCategory })[] };
type FiscalYear = { from: FarmDay; to: FarmDay };

export type SubsidyError = "INVALID_INPUT" | "SUBSIDY_NO_ASSET";

const isLand = (a: Subsidy["assets"][number]) => ASSET_ACCOUNTS[a.category].depreciation === null;

/**
 * FQ17: a subsidy finances at least one asset, with a cost to share it by; its depreciable assets, if any, have a base
 * to release their share over. Land is accepted: PCA p. 75 gives its release rule.
 */
export function checkSubsidy(assets: Subsidy["assets"]): Result<void, SubsidyError> {
  const depreciable = assets.filter((a) => !isLand(a));
  if (assets.reduce((s, a) => s + a.cost, 0n) <= 0n) return fail("SUBSIDY_NO_ASSET");
  if (depreciable.length > 0 && depreciable.reduce((s, a) => s + a.cost - a.residual, 0n) <= 0n) return fail("SUBSIDY_NO_ASSET");
  return ok(undefined);
}

/** The fiscal years from the one starting on `from` to the one starting on `to`, both fiscal-year starts. */
const yearsBetween = (from: FarmDay, to: FarmDay) => Number(to.slice(0, 4)) - Number(from.slice(0, 4));

/**
 * FC2, FQ17, §7 `subsidyRelease`: released to date at the end of the fiscal years ending on or before `end`.
 * - The subsidy is shared by the assets' costs: each land its part (half up on the running total of costs, so the
 *   parts add up to the subsidy), the depreciable assets the rest. Without land, the rest is the whole subsidy.
 * - The depreciable share (PCA p. 75, "proportionnelle à la quote-part des immobilisations amortissables") × Σ
 *   cumulative depreciation of its assets ÷ Σ their depreciable bases, half up once per cumulative figure, so the
 *   releases add up to it once the assets are depreciated.
 * - A land's part (PCA p. 75): ÷ the inalienable years (else ÷ 10) each fiscal year from the one the subsidy is
 *   received in, half up, the last year taking what is left. A land disposed of releases nothing from its disposal's
 *   year on, as a depreciable asset's release stops with its depreciation (FQ28).
 */
function releasedTo(s: Subsidy, fiscalYearStartMonth: number, end: FarmDay): bigint {
  const total = s.assets.reduce((sum, a) => sum + a.cost, 0n);
  if (total <= 0n) return 0n;
  const first = fiscalYearOf(s.receivedOn, fiscalYearStartMonth).from;
  const years = BigInt(s.inalienableYears ?? LAND_RELEASE_YEARS);
  let released = 0n;
  let landCost = 0n;
  let landShare = 0n;
  for (const a of s.assets.filter(isLand)) {
    landCost += a.cost;
    const part = divHalfUp(s.amount * landCost, total) - landShare;
    landShare += part;
    const until = a.disposedOn && a.disposedOn <= end ? fiscalYearOf(a.disposedOn, fiscalYearStartMonth).from : null;
    const held = BigInt(until ? yearsBetween(first, until) : yearsBetween(first, fiscalYearOf(end, fiscalYearStartMonth).from) + 1);
    const each = divHalfUp(part, years);
    released += held <= 0n ? 0n : held >= years || held * each > part ? part : held * each;
  }
  let accumulated = 0n;
  let base = 0n;
  for (const a of s.assets.filter((x) => !isLand(x))) {
    base += a.cost - a.residual;
    accumulated += straightLine(a, fiscalYearStartMonth).filter((y) => y.to <= end).at(-1)?.accumulated ?? a.opening?.accumulated ?? 0n;
  }
  return released + (base > 0n ? divHalfUp((s.amount - landShare) * accumulated, base) : 0n);
}

/**
 * FC2: the fiscal year's release, released to date at its end − what was released before. Nothing before the year it
 * is received in; that year releases what the assets' depreciation so far already earned, and its land's first part.
 */
export function subsidyRelease(s: Subsidy, year: FiscalYear, fiscalYearStartMonth: number): bigint {
  if (s.receivedOn > year.to) return 0n;
  const before = s.receivedOn < year.from ? releasedTo(s, fiscalYearStartMonth, addFarmDays(year.from, -1)) : 0n;
  return releasedTo(s, fiscalYearStartMonth, year.to) - before;
}

export type ReleaseYear = FiscalYear & { release: bigint; released: bigint };

/** FC2 screen: the release by fiscal year, from the year received to the last year its assets are depreciated in or its land released. */
export function releaseSchedule(s: Subsidy, fiscalYearStartMonth: number): ReleaseYear[] {
  const first = fiscalYearOf(s.receivedOn, fiscalYearStartMonth);
  const years = new Map([[first.from, first]]);
  for (const a of s.assets) for (const y of straightLine(a, fiscalYearStartMonth)) if (y.from > first.from) years.set(y.from, { from: y.from, to: y.to });
  if (s.assets.some(isLand))
    for (let k = 1; k < (s.inalienableYears ?? LAND_RELEASE_YEARS); k++) {
      const y = fiscalYearOf(`${Number(first.from.slice(0, 4)) + k}${first.from.slice(4)}` as FarmDay, fiscalYearStartMonth);
      years.set(y.from, y);
    }
  let released = 0n;
  return [...years.values()]
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((y) => {
      const release = subsidyRelease(s, y, fiscalYearStartMonth);
      released += release;
      return { ...y, release, released };
    });
}

/** FC2 receipt (default FQ17): D 5141 (the bank account it is paid into) / C 1311, `BQ`. */
export const receiptPosting = (label: string, amount: bigint, treasuryId: string): Posting => ({
  journal: "BQ",
  label: `Subvention d’investissement : ${label}`,
  lines: [{ account: BANK, debit: amount, credit: 0n, treasuryId }, { account: SUBSIDIES_RECEIVED, debit: 0n, credit: amount }],
});

/** FC2 year-end posting (the close run): the year's release of every subsidy, D 1319 / C 7577, so 1311 stays at the amount received. */
export function yearEndRelease(subsidies: readonly Subsidy[], year: FiscalYear, fiscalYearStartMonth: number): Posting | null {
  const total = subsidies.reduce((sum, s) => sum + subsidyRelease(s, year, fiscalYearStartMonth), 0n);
  if (total === 0n) return null;
  return {
    journal: "OD",
    label: "Quote-part des subventions d’investissement virée au résultat",
    lines: [{ account: SUBSIDIES_RELEASED, debit: total, credit: 0n }, { account: SUBSIDY_RELEASE, debit: 0n, credit: total }],
  };
}
