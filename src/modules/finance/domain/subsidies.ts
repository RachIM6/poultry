import type { FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { ASSET_ACCOUNTS, straightLine, type AssetCategory, type DepreciableAsset, type ScheduleYear } from "@/modules/finance/domain/assets";
import { fiscalYearOf } from "@/modules/finance/domain/entry";
import type { Posting } from "@/modules/finance/domain/posting";

// SPEC-finance FC2 (T106), pure: an investment subsidy, its receipt and its release at the depreciation rate.

export const SUBSIDIES_RECEIVED = "1311"; // Subventions d'investissement reçues
export const SUBSIDIES_RELEASED = "1319"; // Subventions d'investissement inscrites au compte de produits et charges
export const SUBSIDY_RELEASE = "7577"; // Reprises sur subventions d'investissement de l'exercice
const BANK = "5141";

/** What the release needs: the amount, the day received and the register's assets it finances. */
export type Subsidy = { amount: bigint; receivedOn: FarmDay; assets: readonly (DepreciableAsset & { category: AssetCategory })[] };
type FiscalYear = { from: FarmDay; to: FarmDay };

/** n ÷ d rounded half up, for n ≥ 0 and d > 0 (§7.1). */
const halfUp = (n: bigint, d: bigint) => (2n * n + d) / (2n * d);

export type SubsidyError = "INVALID_INPUT" | "SUBSIDY_NO_ASSET" | "SUBSIDY_ON_LAND";

/** FQ17: a subsidy finances at least one asset, none of them land, with a depreciable base to release it over. */
export function checkSubsidy(assets: Subsidy["assets"]): Result<void, SubsidyError> {
  if (assets.some((a) => ASSET_ACCOUNTS[a.category].depreciation === null)) return fail("SUBSIDY_ON_LAND"); // never depreciated: never released
  if (assets.reduce((s, a) => s + a.cost - a.residual, 0n) <= 0n) return fail("SUBSIDY_NO_ASSET");
  return ok(undefined);
}

/**
 * FC2, §7 `subsidyRelease`: released to date = subsidy × Σ cumulative depreciation of its assets (their straight-line
 * schedule, over the fiscal years `upTo` keeps) ÷ Σ their depreciable bases, rounded half up once per cumulative
 * figure, so the releases add up to the subsidy once the assets are depreciated.
 */
function releasedTo(s: Subsidy, fiscalYearStartMonth: number, upTo: (y: ScheduleYear) => boolean): bigint {
  let accumulated = 0n;
  let base = 0n;
  for (const a of s.assets) {
    base += a.cost - a.residual;
    accumulated += straightLine(a, fiscalYearStartMonth).filter(upTo).at(-1)?.accumulated ?? a.opening?.accumulated ?? 0n;
  }
  return base > 0n ? halfUp(s.amount * accumulated, base) : 0n;
}

/**
 * FC2: the fiscal year's release, released to date at its end − what was released before. Nothing before the year it
 * is received in; that year releases what the assets' depreciation so far already earned.
 */
export function subsidyRelease(s: Subsidy, year: FiscalYear, fiscalYearStartMonth: number): bigint {
  if (s.receivedOn > year.to) return 0n;
  const before = s.receivedOn < year.from ? releasedTo(s, fiscalYearStartMonth, (y) => y.to < year.from) : 0n;
  return releasedTo(s, fiscalYearStartMonth, (y) => y.to <= year.to) - before;
}

export type ReleaseYear = FiscalYear & { release: bigint; released: bigint };

/** FC2 screen: the release by fiscal year, from the year received to the last year its assets are depreciated in. */
export function releaseSchedule(s: Subsidy, fiscalYearStartMonth: number): ReleaseYear[] {
  const first = fiscalYearOf(s.receivedOn, fiscalYearStartMonth);
  const years = new Map([[first.from, first]]);
  for (const a of s.assets) for (const y of straightLine(a, fiscalYearStartMonth)) if (y.from > first.from) years.set(y.from, { from: y.from, to: y.to });
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
